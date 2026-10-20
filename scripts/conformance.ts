/**
 * Conformance run against a live Hearth MCP server and auth server.
 *
 *   HEARTH_MCP_BASE=http://localhost:4200 HEARTH_AUTH_ISSUER=http://localhost:4100 pnpm conformance
 *
 * Writes apps/mcp-server/reports/conformance.{json,md} and exits 1 if any check fails.
 * It writes a little data to the home it runs against (one probe asset, one order, one brief, one log entry).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  AuthorizationServerMetadata,
  CheckoutSessionResponse,
  CompletedCheckoutResponse,
  CreateCheckoutOutput,
  CompleteCheckoutOutput,
  FindPartOutput,
  InsufficientScopeBody,
  MCP_APP_MIME,
  MCP_PROTOCOL_VERSION,
  ProBriefOutput,
  ProtectedResourceMetadata,
  RepairStepsOutput,
  SCOPES,
  TOOLS,
  TriageOutput,
  UiMeta,
  UnauthorizedBody,
  toolSpec,
  type ToolName,
} from "@hearth/contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import { linkAccount } from "./lib/link-account";

const mcpBase = (process.env.HEARTH_MCP_BASE ?? "http://localhost:4200").replace(/\/+$/, "");
const issuer = (process.env.HEARTH_AUTH_ISSUER ?? "http://localhost:4100").replace(/\/+$/, "");
const resource = `${mcpBase}/mcp`;
const reportDir = new URL("../apps/mcp-server/reports/", import.meta.url);

interface Check {
  group: string;
  name: string;
  status: "pass" | "fail";
  detail: string;
  ms: number;
}

const checks: Check[] = [];
const run = Date.now().toString(36);
let counter = 0;
const key = (label: string): string => `conf-${label}-${run}-${(counter += 1)}`;

async function check(group: string, name: string, fn: () => Promise<string | void>): Promise<boolean> {
  const started = performance.now();
  try {
    const detail = (await fn()) ?? "";
    checks.push({ group, name, status: "pass", detail, ms: Math.round(performance.now() - started) });
    return true;
  } catch (err) {
    checks.push({ group, name, status: "fail", detail: err instanceof Error ? err.message : String(err), ms: Math.round(performance.now() - started) });
    return false;
  }
}

function must(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const textOf = (r: CallToolResult): string => {
  const first = r.content[0];
  return first && first.type === "text" ? first.text : "";
};

/** Reads the claims of a JWT without verifying it; the server is the one that verifies. */
function decodeClaims(token: string): { iss?: string; sub?: string; aud?: string | string[] } {
  const payload = token.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { iss?: string; sub?: string; aud?: string | string[] };
}

const LONG_DASH = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

/* ------------------------------------------------------------------ HTTP helpers */

async function http(path: string, init: { token?: string; method?: string; body?: unknown } = {}): Promise<{ status: number; headers: Headers; text: string; json: unknown }> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const res = await fetch(`${mcpBase}${path}`, {
    method: init.method ?? "GET",
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // SSE or HTML; callers that need JSON-RPC use sseJson.
  }
  return { status: res.status, headers: res.headers, text, json };
}

function sseJson(text: string): unknown {
  const line = text
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .pop();
  return line ? (JSON.parse(line) as unknown) : JSON.parse(text);
}

const INITIALIZE_BODY = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "hearth-conformance", version: "1.0.0" } },
};

/* ------------------------------------------------------------------ main */

async function main(): Promise<void> {
  console.log(`Hearth conformance\n  MCP server  ${mcpBase}\n  Auth server ${issuer}\n`);

  await check("discovery", "protected resource metadata (RFC 9728) has the documented shape", async () => {
    const res = await http("/.well-known/oauth-protected-resource");
    must(res.status === 200, `expected 200, got ${res.status}`);
    const prm = ProtectedResourceMetadata.parse(res.json);
    must(prm.resource === resource, `resource ${prm.resource} should be ${resource}`);
    must(prm.authorization_servers.includes(issuer), `authorization_servers ${prm.authorization_servers.join(",")} should include ${issuer}`);
    for (const scope of SCOPES) must(prm.scopes_supported.includes(scope), `scopes_supported is missing ${scope}`);
    must(prm.bearer_methods_supported.includes("header"), "bearer_methods_supported should include header");
    return `resource ${prm.resource}`;
  });

  await check("discovery", "authorization server metadata (RFC 8414) validates", async () => {
    const res = await fetch(`${issuer}/.well-known/oauth-authorization-server`);
    must(res.status === 200, `expected 200, got ${res.status}`);
    const meta = AuthorizationServerMetadata.parse(await res.json());
    must(meta.code_challenge_methods_supported.includes("S256"), "S256 is required");
    return `issuer ${meta.issuer}`;
  });

  await check("auth", "unauthenticated POST /mcp returns 401 JSON with no WWW-Authenticate", async () => {
    const res = await http("/mcp", { method: "POST", body: INITIALIZE_BODY });
    must(res.status === 401, `expected 401, got ${res.status}`);
    must(!res.headers.has("www-authenticate"), "WWW-Authenticate header must be absent");
    must((res.headers.get("content-type") ?? "").includes("application/json"), "content-type must be application/json");
    const body = UnauthorizedBody.parse(res.json);
    must(body.resource_metadata === `${mcpBase}/.well-known/oauth-protected-resource`, `resource_metadata was ${body.resource_metadata}`);
    return "body matches Appendix B";
  });

  await check("auth", "a garbage bearer token gets the same 401", async () => {
    const res = await http("/mcp", { method: "POST", token: "not.a.jwt", body: INITIALIZE_BODY });
    must(res.status === 401 && !res.headers.has("www-authenticate"), `status ${res.status}, www-authenticate ${res.headers.get("www-authenticate")}`);
    UnauthorizedBody.parse(res.json);
  });

  let accessToken = "";
  const linked = await check("auth", "account linking (PKCE) issues a token for the MCP resource", async () => {
    const token = await linkAccount({ issuer, resource });
    accessToken = token.access_token;
    const claims = decodeClaims(accessToken);
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    must(aud.includes(resource), `aud ${aud.join(",")} should include ${resource}`);
    must(claims.iss === issuer, `iss ${claims.iss} should be ${issuer}`);
    must(typeof claims.sub === "string" && claims.sub !== "", "sub is missing");
    for (const scope of SCOPES) must(token.scope.split(" ").includes(scope), `scope ${scope} not granted`);
    return `sub ${String(claims.sub)}, expires in ${token.expires_in}s`;
  });
  if (!linked) return;

  let rawSession = "";
  await check("protocol", "initialize returns protocolVersion 2025-11-25, serverInfo, capabilities and Mcp-Session-Id", async () => {
    const res = await http("/mcp", { method: "POST", token: accessToken, body: INITIALIZE_BODY });
    must(res.status === 200, `expected 200, got ${res.status}: ${res.text.slice(0, 200)}`);
    rawSession = res.headers.get("mcp-session-id") ?? "";
    must(rawSession !== "", "Mcp-Session-Id header is missing");
    const result = (sseJson(res.text) as { result: { protocolVersion: string; serverInfo: { name: string; version: string }; capabilities: Record<string, unknown> } }).result;
    must(result.protocolVersion === MCP_PROTOCOL_VERSION, `protocolVersion ${result.protocolVersion}`);
    must(result.serverInfo.name === "hearth", `serverInfo.name ${result.serverInfo.name}`);
    for (const cap of ["tools", "resources", "logging"]) must(cap in result.capabilities, `capabilities.${cap} missing`);
    must(!("prompts" in result.capabilities) && !("sampling" in result.capabilities), "prompts and sampling must not be advertised");
    return `hearth ${result.serverInfo.version}, session ${rawSession.slice(0, 8)}`;
  });

  await check("protocol", "DELETE /mcp ends the session", async () => {
    const headers = { Authorization: `Bearer ${accessToken}`, "Mcp-Session-Id": rawSession, "Mcp-Protocol-Version": MCP_PROTOCOL_VERSION, "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
    const del = await fetch(`${mcpBase}/mcp`, { method: "DELETE", headers });
    must(del.status === 200 || del.status === 204, `DELETE returned ${del.status}`);
    const after = await fetch(`${mcpBase}/mcp`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) });
    must(after.status === 404, `a request on the ended session should be 404, got ${after.status}`);
    return "session gone after DELETE";
  });

  const transport = new StreamableHTTPClientTransport(new URL(resource), { requestInit: { headers: { Authorization: `Bearer ${accessToken}` } } });
  const client = new Client({ name: "hearth-conformance", version: "1.0.0" });
  const connected = await check("protocol", "the SDK client connects over Streamable HTTP", async () => {
    await client.connect(transport);
    return `server ${client.getServerVersion()?.name ?? "?"}`;
  });
  if (!connected) return;

  await check("protocol", "tools/list returns the 12 tools with title, description, schemas and annotations", async () => {
    const { tools } = await client.listTools();
    must(tools.length === 12, `expected 12 tools, got ${tools.length}`);
    for (const spec of TOOLS) {
      const tool = tools.find((t) => t.name === spec.name);
      must(tool, `${spec.name} is missing`);
      must(tool.title && tool.title.length > 0, `${spec.name} has no title`);
      must(tool.description && tool.description.length > 20, `${spec.name} has no description`);
      must(tool.inputSchema.type === "object", `${spec.name} inputSchema is not an object schema`);
      must(tool.outputSchema?.type === "object", `${spec.name} has no outputSchema`);
      for (const hint of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const) {
        must(tool.annotations?.[hint] === spec.annotations[hint], `${spec.name} annotation ${hint} is ${String(tool.annotations?.[hint])}, contract says ${String(spec.annotations[hint])}`);
      }
      const ui = (tool._meta as { ui?: { resourceUri?: string; pattern?: string } } | undefined)?.ui;
      if (spec.widget) must(ui?.resourceUri?.startsWith("ui://hearth/") && ui.pattern, `${spec.name} has no _meta.ui`);
      else must(!ui, `${spec.name} is voice only but has _meta.ui`);
    }
    return TOOLS.map((t) => t.name).join(", ");
  });

  const widgetUris = new Set<string>();
  await check("resources", "resources/list exposes at least 8 ui://hearth/ widgets with the MCP Apps mime type", async () => {
    const { resources } = await client.listResources();
    must(resources.length >= 8, `expected at least 8, got ${resources.length}`);
    for (const r of resources) {
      must(r.uri.startsWith("ui://hearth/"), `${r.uri} is not under ui://hearth/`);
      must(r.mimeType === MCP_APP_MIME, `${r.uri} has mimeType ${String(r.mimeType)}`);
      const mcpApp = (r._meta as { mcpApp?: { csp?: unknown; pattern?: string } } | undefined)?.mcpApp;
      must(mcpApp?.csp && mcpApp.pattern, `${r.uri} has no _meta.mcpApp csp and pattern`);
      widgetUris.add(r.uri);
    }
    return `${resources.length} widgets`;
  });

  await check("resources", "resources/read returns HTML for every widget", async () => {
    for (const uri of widgetUris) {
      const read = await client.readResource({ uri });
      const content = read.contents[0];
      must(content && "text" in content && /<html|<!doctype/i.test(content.text), `${uri} did not return an HTML document`);
      must(content.mimeType === MCP_APP_MIME, `${uri} came back as ${String(content.mimeType)}`);
    }
    return `${widgetUris.size} read`;
  });

  /* -------------------------------------------------------------- tool calls */

  async function call(name: ToolName, args: Record<string, unknown> = {}): Promise<CallToolResult> {
    const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
    const text = textOf(result);
    must(text.length > 0, `${name} returned no spoken summary`);
    must(!LONG_DASH.test(text), `${name} spoken text contains an em or en dash`);
    must(typeof (result._meta as Record<string, unknown> | undefined)?.["hearth/serverMs"] === "number", `${name} has no _meta["hearth/serverMs"]`);
    return result;
  }

  /** A successful call: structuredContent validates against the contract and visual tools carry _meta.ui. */
  async function ok<T>(name: ToolName, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<{ data: T; result: CallToolResult }> {
    const result = await call(name, args);
    must(!result.isError, `${name} returned an error: ${textOf(result)}`);
    const spec = toolSpec(name);
    must(spec, `no contract for ${name}`);
    const data = schema.parse(result.structuredContent);
    const meta = result._meta as Record<string, unknown>;
    if (spec.widget) {
      const ui = UiMeta.parse(meta.ui);
      must(ui.widget === spec.widget, `_meta.ui.widget is ${ui.widget}, expected ${spec.widget}`);
      must(widgetUris.has(ui.resourceUri), `${ui.resourceUri} is not in resources/list`);
      must(JSON.stringify(ui.props) === JSON.stringify(result.structuredContent), "_meta.ui.props differs from structuredContent");
    } else {
      must(meta.ui === undefined, `${name} is voice only but carries _meta.ui`);
    }
    return { data, result };
  }

  const detail = (r: CallToolResult): string => textOf(r).slice(0, 110);
  const contract = (name: ToolName): z.ZodType => {
    const spec = toolSpec(name);
    must(spec, `no contract for ${name}`);
    return spec.output;
  };

  await check("tools", "get_home_profile", async () => {
    const { result } = await ok("get_home_profile", {}, contract("get_home_profile"));
    return detail(result);
  });

  await check("tools", "add_asset creates then updates a probe asset idempotently", async () => {
    const args = { type: "fixture", category: "conformance_probe", label: "conformance test marker", location: { room: "Garage", note: "added by the conformance run" } };
    const first = await ok("add_asset", { ...args, idempotencyKey: key("asset") }, contract("add_asset"));
    const again = await ok("add_asset", { ...args, idempotencyKey: key("asset") }, contract("add_asset"));
    const a = first.data as { highlight?: { assetId: string; created: boolean } };
    const b = again.data as { highlight?: { assetId: string; created: boolean } };
    must(a.highlight && b.highlight, "highlight is missing");
    must(a.highlight.assetId === b.highlight.assetId, "the same category and room must update the same asset");
    must(b.highlight.created === false, "the second call should update, not create");
    return `${a.highlight.assetId} (first call created: ${a.highlight.created})`;
  });

  let issueId = "";
  await check("tools", "triage_issue asks at most two questions, then resolves a playbook", async () => {
    const symptomText = "there's water under the kitchen sink";
    const answers: Record<string, string> = {};
    let out = (await ok("triage_issue", { symptomText }, TriageOutput)).data;
    for (let round = 0; round < 3 && !out.issueId && out.clarifyingQuestions.length > 0; round += 1) {
      must(out.clarifyingQuestions.length <= 2, "more than two clarifying questions");
      for (const q of out.clarifyingQuestions) answers[q.id] = (q.options?.[0] ?? "pipes").toLowerCase();
      out = (await ok("triage_issue", { symptomText, answers }, TriageOutput)).data;
    }
    must(out.issueId, "triage never resolved to a playbook");
    must(!out.safety.hardStop, "an under-sink leak should not be a hard stop");
    issueId = out.issueId;
    return `${out.issueId} at confidence ${out.confidence}`;
  });

  await check("tools", "triage_issue hard-stops on a gas smell and gives a verbatim message", async () => {
    const { data, result } = await ok("triage_issue", { symptomText: "I can smell gas near the furnace" }, TriageOutput);
    must(data.safety.hardStop && data.safety.message, "gas smell was not a hard stop");
    must(textOf(result) === data.safety.message, "spoken text must be the safety message verbatim");
    return data.safety.category ?? "";
  });

  let partRole = "";
  let partAssetId: string | undefined;
  await check("tools", "get_repair_steps walks every step of the resolved playbook", async () => {
    must(issueId, "no issueId from triage");
    let count = 1;
    for (let i = 0; i < count; i += 1) {
      const { data } = await ok("get_repair_steps", { issueId, stepIndex: i }, RepairStepsOutput);
      count = data.stepCount;
      must(data.stepIndex === i && data.isLast === (i === count - 1), `step ${i} reports index ${data.stepIndex}, isLast ${data.isLast}`);
      if (data.partNeeded && !partRole) {
        partRole = data.partNeeded.partRole;
        partAssetId = data.partNeeded.assetId;
      }
    }
    return `${count} steps, part role ${partRole || "none"}`;
  });

  await check("tools", "get_repair_steps past the end is a voice-safe isError", async () => {
    const r = await call("get_repair_steps", { issueId, stepIndex: 99 });
    must(r.isError === true, "expected isError");
    must((r.structuredContent as { error?: { code?: string } } | undefined)?.error?.code === "invalid_input", "expected code invalid_input");
  });

  let sku = "";
  await check("tools", "find_exact_part returns 3 to 5 ranked, fit-reasoned items", async () => {
    const { data } = await ok("find_exact_part", { ...(partAssetId ? { assetId: partAssetId } : { issueId }), partRole: partRole || "ptrap_washer" }, FindPartOutput);
    must(data.items.length >= 3 && data.items.length <= 5, `expected 3 to 5 items, got ${data.items.length}`);
    for (const item of data.items) must(item.fitReason.length > 0, `${item.sku} has no fitReason`);
    sku = data.items[0]?.sku ?? "";
    return `${data.items.length} items, first ${data.items[0]?.badge ?? ""}`;
  });

  await check("tools", "find_exact_part with an unknown role is a voice-safe isError (not_found)", async () => {
    const r = await call("find_exact_part", { partRole: "flux_capacitor" });
    must(r.isError === true, "expected isError");
    must((r.structuredContent as { error?: { code?: string } } | undefined)?.error?.code === "not_found", "expected code not_found");
    must(!/\b[A-Z]{2,}-[A-Z0-9-]+\b/.test(textOf(r)), "voice text leaks a SKU");
  });

  let sessionId = "";
  await check("checkout", "create_checkout_session never charges and returns the commitment text", async () => {
    must(sku, "no SKU from find_exact_part");
    const { data, result } = await ok("create_checkout_session", { sku, qty: 1, idempotencyKey: key("create") }, CreateCheckoutOutput);
    sessionId = data.sessionId;
    must(/^You're ordering \d+× .+ for \$\d+\.\d{2}, arriving [A-Z][a-z]+day\. Paid with .+\.$/.test(data.commitmentText), `commitmentText format: ${data.commitmentText}`);
    must(data.totals.currency === "USD" && data.totals.shipping === 0, "totals should be USD with free shipping");
    must(Math.abs(data.totals.subtotal * 0.0825 - data.totals.tax) < 0.006, "tax should be 8.25 percent of the subtotal");
    must(textOf(result).endsWith("Confirm?"), "spoken text should end by asking Confirm?");
    return data.commitmentText;
  });

  await check("checkout", "complete_checkout without a confirmation is isError not_confirmed", async () => {
    const r = await call("complete_checkout", { sessionId, userConfirmed: false, confirmationPhrase: "yes", idempotencyKey: key("done") });
    must(r.isError === true, "expected isError");
    must((r.structuredContent as { error?: { code?: string } } | undefined)?.error?.code === "not_confirmed", "expected code not_confirmed");
  });

  let receiptUrl = "";
  let orderNumber = "";
  let emailStatus = "";
  await check("checkout", "complete_checkout returns a rich confirmation, and a replay returns the same order", async () => {
    const args = { sessionId, userConfirmed: true, confirmationPhrase: "yes, confirm", idempotencyKey: key("done") };
    const { data } = await ok("complete_checkout", args, CompleteCheckoutOutput);
    const replay = await ok("complete_checkout", args, CompleteCheckoutOutput);
    must(replay.data.orderId === data.orderId, "a repeated idempotency key must return the same order");
    receiptUrl = data.receiptUrl;
    orderNumber = data.orderNumber;
    emailStatus = data.emailStatus;
    must(data.summary.length > 20 && data.chargedAmount > 0, "confirmation is not rich enough");
    return `${data.orderNumber}, ${data.paymentMode}, email ${data.emailStatus}`;
  });

  await check("checkout", "the receipt page renders", async () => {
    const res = await fetch(receiptUrl);
    const html = await res.text();
    must(res.status === 200 && html.includes(orderNumber), `receipt returned ${res.status} and ${html.includes(orderNumber) ? "" : "not "}the order number`);
    return receiptUrl;
  });

  await check("checkout", "the confirmation email is delivered or written to the outbox", async () => {
    if (emailStatus === "sent") return "sent through Resend";
    const res = await fetch(`${mcpBase}/outbox`);
    const html = await res.text();
    must(res.status === 200 && html.includes("is confirmed"), "the outbox lists no confirmation");
    return "written to /outbox";
  });

  await check("tools", "prepare_pro_brief builds a brief with a public share page", async () => {
    const { data, result } = await ok("prepare_pro_brief", { issueId, symptom: "Water is coming from the body of the garbage disposal", attempted: ["Tightened the drain flange"], idempotencyKey: key("brief") }, ProBriefOutput);
    must(data.shareUrl === data.qrPayload, "qrPayload should be the share URL");
    must(/\?$/.test(data.handoffLine), `handoffLine should be a question: ${data.handoffLine}`);
    const page = await fetch(data.shareUrl);
    must(page.status === 200 && (await page.text()).includes("JOB BRIEF"), `share page returned ${page.status}`);
    return detail(result);
  });

  await check("tools", "get_weekend_plan returns at most 6 ranked tasks", async () => {
    const { data } = await ok("get_weekend_plan", {}, contract("get_weekend_plan"));
    const plan = data as { weekendLabel: string; tasks: unknown[] };
    must(plan.tasks.length <= 6, `${plan.tasks.length} tasks`);
    return `${plan.weekendLabel}, ${plan.tasks.length} tasks`;
  });

  await check("tools", "log_completion records the job and is idempotent", async () => {
    const args = { kind: "repair", summary: "Conformance run: replaced the P-trap washer", issueId, ...(sku ? { partSku: sku } : {}), idempotencyKey: key("log") };
    const first = await ok("log_completion", args, contract("log_completion"));
    const again = await ok("log_completion", args, contract("log_completion"));
    must((first.data as { eventId: string }).eventId === (again.data as { eventId: string }).eventId, "a repeated key must return the same event");
    return detail(first.result);
  });

  await check("tools", "get_history filters by keyword", async () => {
    const { data } = await ok("get_history", { query: "disposal" }, contract("get_history"));
    return `${(data as { events: unknown[] }).events.length} events match "disposal"`;
  });

  await check("tools", "check_recalls discloses that the dataset is a sample", async () => {
    const { data } = await ok("check_recalls", {}, contract("check_recalls"));
    const recalls = data as { datasetLabel: string; flagged: unknown[] };
    must(/sample/i.test(recalls.datasetLabel), `datasetLabel: ${recalls.datasetLabel}`);
    return `${recalls.flagged.length} flagged`;
  });

  await check("auth", "a token without orders:write cannot start a checkout (forbidden_scope)", async () => {
    const readOnly = await linkAccount({ issuer, resource, scope: "home:read" });
    const c = new Client({ name: "hearth-conformance-readonly", version: "1.0.0" });
    await c.connect(new StreamableHTTPClientTransport(new URL(resource), { requestInit: { headers: { Authorization: `Bearer ${readOnly.access_token}` } } }));
    try {
      const r = (await c.callTool({ name: "create_checkout_session", arguments: { sku: sku || "x", qty: 1, idempotencyKey: key("scope") } })) as CallToolResult;
      must(r.isError === true, "expected isError");
      must((r.structuredContent as { error?: { code?: string } } | undefined)?.error?.code === "forbidden_scope", "expected code forbidden_scope");
      const rest = await http("/checkout-sessions", { method: "POST", token: readOnly.access_token, body: { line_items: [{ sku: sku || "x", quantity: 1 }], idempotency_key: key("scope-rest") } });
      must(rest.status === 403, `REST should be 403, got ${rest.status}`);
      InsufficientScopeBody.parse(rest.json);
    } finally {
      await c.close();
    }
  });

  /* -------------------------------------------------------------- REST checkout */

  let restId = "";
  await check("rest", "POST /checkout-sessions creates a UCP-shaped session", async () => {
    const body = { line_items: [{ sku, quantity: 1 }], idempotency_key: key("rest-create") };
    const res = await http("/checkout-sessions", { method: "POST", token: accessToken, body });
    must(res.status === 200, `expected 200, got ${res.status}: ${res.text.slice(0, 200)}`);
    const s = CheckoutSessionResponse.parse(res.json);
    must(s.status === "ready_for_complete", `status ${s.status}`);
    restId = s.id;
    const again = CheckoutSessionResponse.parse((await http("/checkout-sessions", { method: "POST", token: accessToken, body })).json);
    must(again.id === s.id, "the same idempotency_key must return the same session");
    return s.commitment_text;
  });

  await check("rest", "GET /checkout-sessions/:id returns the session", async () => {
    const res = await http(`/checkout-sessions/${restId}`, { token: accessToken });
    must(res.status === 200, `expected 200, got ${res.status}`);
    must(CheckoutSessionResponse.parse(res.json).id === restId, "wrong session returned");
  });

  await check("rest", "POST /checkout-sessions/:id/complete requires confirmation, then completes", async () => {
    const path = `/checkout-sessions/${restId}/complete`;
    const refused = await http(path, { method: "POST", token: accessToken, body: { confirmation_phrase: "yes", idempotency_key: key("rest-refuse") } });
    must(refused.status === 400, `unconfirmed complete should be 400, got ${refused.status}`);
    const done = await http(path, { method: "POST", token: accessToken, body: { user_confirmed: true, confirmation_phrase: "yes", idempotency_key: key("rest-done") } });
    must(done.status === 200, `expected 200, got ${done.status}: ${done.text.slice(0, 200)}`);
    const parsed = CompletedCheckoutResponse.parse(done.json);
    const receipt = await fetch(parsed.confirmation.receipt_url);
    must(receipt.status === 200, `receipt returned ${receipt.status}`);
    return parsed.order.number;
  });

  await client.close();
}

/* ------------------------------------------------------------------ report */

function render(): { json: string; markdown: string; failed: number } {
  const failed = checks.filter((c) => c.status === "fail").length;
  const at = new Date().toISOString();
  const json = JSON.stringify({ generatedAt: at, mcpBase, authIssuer: issuer, protocolVersion: MCP_PROTOCOL_VERSION, passed: checks.length - failed, failed, checks }, null, 2);
  const rows = checks.map((c) => `| ${c.group} | ${c.name} | ${c.status === "pass" ? "PASS" : "FAIL"} | ${c.ms} | ${c.detail.replace(/\|/g, "/").replace(/\s+/g, " ")} |`);
  const markdown = [
    "# Hearth conformance report",
    "",
    `Run at ${at} against ${mcpBase} (auth ${issuer}), protocol ${MCP_PROTOCOL_VERSION}.`,
    "",
    `Result: ${checks.length - failed} passed, ${failed} failed.`,
    "",
    "| Group | Check | Result | ms | Detail |",
    "| --- | --- | --- | ---: | --- |",
    ...rows,
    "",
  ].join("\n");
  return { json, markdown, failed };
}

function printTable(): void {
  const width = Math.min(86, Math.max(...checks.map((c) => c.name.length), 10));
  console.log(`${"RESULT".padEnd(7)}${"GROUP".padEnd(11)}${"CHECK".padEnd(width + 2)}MS`);
  for (const c of checks) {
    console.log(`${(c.status === "pass" ? "PASS" : "FAIL").padEnd(7)}${c.group.padEnd(11)}${c.name.slice(0, width).padEnd(width + 2)}${c.ms}`);
    if (c.status === "fail") console.log(`       ${c.detail}`);
  }
}

try {
  await main();
} catch (err) {
  checks.push({ group: "run", name: "conformance run completed", status: "fail", detail: err instanceof Error ? err.message : String(err), ms: 0 });
}

printTable();
const { json, markdown, failed } = render();
await mkdir(fileURLToPath(reportDir), { recursive: true });
await writeFile(new URL("conformance.json", reportDir), json);
await writeFile(new URL("conformance.md", reportDir), markdown);
console.log(`\n${checks.length - failed}/${checks.length} checks passed. Reports written to apps/mcp-server/reports/conformance.{json,md}`);
process.exit(failed > 0 ? 1 : 0);
