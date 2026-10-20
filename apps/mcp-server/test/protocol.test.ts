import { MCP_APP_MIME, MCP_PROTOCOL_VERSION, TOOLS, UnauthorizedBody, ProtectedResourceMetadata } from "@hearth/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pkg from "../package.json";
import { INITIALIZE, rest, rpc } from "./fixtures/rpc";
import { type Harness, startHarness } from "./fixtures/harness";
import { OTHER_USER } from "./fixtures/seed";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});

describe("initialize", () => {
  it("negotiates 2025-11-25 and advertises tools, resources and logging only", async () => {
    const client = await h.connect();
    expect(client.getServerVersion()).toMatchObject({ name: "hearth", version: pkg.version });
    const caps = client.getServerCapabilities();
    expect(caps).toBeDefined();
    expect(Object.keys(caps ?? {}).sort()).toEqual(["logging", "resources", "tools"]);
    expect(caps?.prompts).toBeUndefined();

    const raw = await rpc(h.base, { token: await h.mint(), body: INITIALIZE });
    expect(raw.status).toBe(200);
    expect(raw.headers.get("mcp-session-id")).toMatch(/^[0-9a-f-]{36}$/);
    const result = (raw.body as { result: { protocolVersion: string } }).result;
    expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
  });
});

describe("tools/list", () => {
  it("lists all 12 tools with title, description, schemas and annotations", async () => {
    const client = await h.connect();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(12);
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());
    for (const tool of tools) {
      const spec = TOOLS.find((t) => t.name === tool.name);
      expect(spec).toBeDefined();
      expect(tool.title).toBe(spec?.title);
      expect(tool.description).toBe(spec?.description);
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.outputSchema?.type).toBe("object");
      expect(tool.annotations).toMatchObject({
        readOnlyHint: spec?.annotations.readOnlyHint,
        destructiveHint: spec?.annotations.destructiveHint,
        idempotentHint: spec?.annotations.idempotentHint,
        openWorldHint: spec?.annotations.openWorldHint,
      });
    }
  });

  it("accepts the error envelope in every outputSchema, so SDK clients do not throw on isError results", async () => {
    const client = await h.connect();
    const { tools } = await client.listTools();
    for (const tool of tools) {
      const branches = (tool.outputSchema as { anyOf?: { properties?: Record<string, unknown> }[] } | undefined)?.anyOf;
      expect(branches, tool.name).toHaveLength(2);
      expect(branches?.[1]?.properties, tool.name).toHaveProperty("error");
    }
    const denied = await client.callTool({ name: "find_exact_part", arguments: { partRole: "flux_capacitor" } });
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toMatchObject({ error: { code: "not_found" } });
  });

  it("points every visual tool at its widget resource", async () => {
    const client = await h.connect();
    const { tools } = await client.listTools();
    const { resources } = await client.listResources();
    for (const spec of TOOLS) {
      const tool = tools.find((t) => t.name === spec.name);
      const ui = (tool?._meta as { ui?: { resourceUri: string; pattern: string } } | undefined)?.ui;
      if (spec.widget === null) {
        expect(ui).toBeUndefined();
        continue;
      }
      expect(ui?.resourceUri).toMatch(new RegExp(`^ui://hearth/${spec.widget}-[0-9a-f]+\\.html$`));
      expect(["card", "carousel", "list", "map"]).toContain(ui?.pattern);
      expect(resources.map((r) => r.uri)).toContain(ui?.resourceUri);
    }
  });
});

describe("resources", () => {
  it("lists every widget as ui://hearth with the MCP Apps mime type and reads its HTML", async () => {
    const client = await h.connect();
    const { resources } = await client.listResources();
    expect(resources).toHaveLength(8);
    for (const r of resources) {
      expect(r.uri.startsWith("ui://hearth/")).toBe(true);
      expect(r.mimeType).toBe(MCP_APP_MIME);
      const meta = r._meta as { mcpApp: { pattern: string; csp: { resourceDomains: string[] } } };
      expect(meta.mcpApp.pattern).toMatch(/card|carousel|list|map/);
      expect(meta.mcpApp.csp.resourceDomains).toEqual([new URL(h.base).origin]);
      const read = await client.readResource({ uri: r.uri });
      const first = read.contents[0];
      expect(first && "text" in first ? first.text : "").toContain("<!doctype html>");
      expect(first?.mimeType).toBe(MCP_APP_MIME);
    }
  });

  it("rejects an unknown resource", async () => {
    const client = await h.connect();
    await expect(client.readResource({ uri: "ui://hearth/nope.html" })).rejects.toThrow(/not found/i);
  });

  it("serves an empty list, and visual tools degrade to text, when the manifest is missing", async () => {
    const bare = await startHarness({ noWidgets: true });
    try {
      const client = await bare.connect();
      expect((await client.listResources()).resources).toEqual([]);
      const res = await client.callTool({ name: "get_home_profile", arguments: {} });
      expect(res.isError).toBeFalsy();
      expect(res.structuredContent).toBeDefined();
      expect((res._meta as Record<string, unknown>).ui).toBeUndefined();
    } finally {
      await bare.close();
    }
  });
});

describe("auth", () => {
  it("returns Appendix B on an unauthenticated POST /mcp with no WWW-Authenticate header", async () => {
    const res = await rpc(h.base, { body: INITIALIZE });
    expect(res.status).toBe(401);
    expect(res.headers.has("www-authenticate")).toBe(false);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(UnauthorizedBody.parse(res.body)).toEqual({
      error: "unauthorized",
      error_description: "Link your Hearth account to continue.",
      resource_metadata: `${h.base}/.well-known/oauth-protected-resource`,
    });
  });

  it.each([
    ["a token for another audience", { audience: "http://localhost:9999/mcp" }],
    ["a token from another issuer", { issuer: "http://evil.example" }],
    ["an expired token", { expiresIn: "-1m" }],
    ["a token signed by an unknown key", { untrustedKey: true }],
  ])("rejects %s with the same 401 and no WWW-Authenticate", async (_label, opts) => {
    const res = await rpc(h.base, { token: await h.mint(opts), body: INITIALIZE });
    expect(res.status).toBe(401);
    expect(res.headers.has("www-authenticate")).toBe(false);
    expect(UnauthorizedBody.safeParse(res.body).success).toBe(true);
  });

  it("rejects a malformed Authorization header and protects /checkout-sessions too", async () => {
    const bad = await fetch(`${h.base}/mcp`, { method: "POST", headers: { Authorization: "Basic abc", "Content-Type": "application/json" }, body: "{}" });
    expect(bad.status).toBe(401);
    const rest401 = await rest(h.base, "/checkout-sessions/cs_x");
    expect(rest401.status).toBe(401);
    expect(rest401.headers.has("www-authenticate")).toBe(false);
  });

  it("serves protected resource metadata per RFC 9728", async () => {
    const res = await rest(h.base, "/.well-known/oauth-protected-resource");
    expect(res.status).toBe(200);
    expect(ProtectedResourceMetadata.parse(res.body)).toEqual({
      resource: `${h.base}/mcp`,
      authorization_servers: ["http://localhost:4100"],
      scopes_supported: ["home:read", "home:write", "orders:write"],
      bearer_methods_supported: ["header"],
      resource_name: "Hearth",
    });
  });

  it("serves the same metadata at the path-suffixed RFC 9728 URL", async () => {
    const root = await rest(h.base, "/.well-known/oauth-protected-resource");
    const suffixed = await rest(h.base, "/.well-known/oauth-protected-resource/mcp");
    expect(suffixed.status).toBe(200);
    expect(suffixed.body).toEqual(root.body);
  });

  it("answers a tool call that needs a missing scope with isError and forbidden_scope", async () => {
    const client = await h.connect(await h.mint({ scope: "home:read" }));
    const ok = await client.callTool({ name: "get_home_profile", arguments: {} });
    expect(ok.isError).toBeFalsy();
    const denied = await client.callTool({ name: "create_checkout_session", arguments: { sku: "HR-PT-150-WSH", qty: 1, idempotencyKey: "scope-test-1" } });
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toMatchObject({ error: { code: "forbidden_scope" } });
    const write = await client.callTool({ name: "log_completion", arguments: { kind: "maintenance", summary: "Cleaned the gutters", idempotencyKey: "scope-test-2" } });
    expect(write.structuredContent).toMatchObject({ error: { code: "forbidden_scope" } });
  });

  it("returns no_home for a valid user with no home", async () => {
    const client = await h.connect(await h.mint({ sub: "usr_nobody" }));
    const res = await client.callTool({ name: "get_home_profile", arguments: {} });
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toMatchObject({ error: { code: "no_home" } });
  });
});

describe("sessions", () => {
  it("rejects another user's session id", async () => {
    const ownerToken = await h.mint();
    const init = await rpc(h.base, { token: ownerToken, body: INITIALIZE });
    const sid = init.headers.get("mcp-session-id") ?? "";
    expect(sid).not.toBe("");

    const intruder = await h.mint({ sub: OTHER_USER });
    const attempt = await rpc(h.base, { token: intruder, sessionId: sid, body: { jsonrpc: "2.0", id: 2, method: "tools/list" } });
    expect(attempt.status).toBe(403);

    const owner = await rpc(h.base, { token: ownerToken, sessionId: sid, body: { jsonrpc: "2.0", id: 2, method: "tools/list" } });
    expect(owner.status).toBe(200);
    expect((owner.body as { result: { tools: unknown[] } }).result.tools).toHaveLength(12);
  });

  it("requires initialize first and 404s an unknown session", async () => {
    const token = await h.mint();
    const early = await rpc(h.base, { token, body: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    expect(early.status).toBe(400);
    const unknown = await rpc(h.base, { token, sessionId: "00000000-0000-4000-8000-000000000000", body: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    expect(unknown.status).toBe(404);
  });

  it("opens the server-to-client SSE stream for the owner only", async () => {
    const token = await h.mint();
    const init = await rpc(h.base, { token, body: INITIALIZE });
    const sid = init.headers.get("mcp-session-id") ?? "";
    const headers = (t: string) => ({ Authorization: `Bearer ${t}`, Accept: "text/event-stream", "Mcp-Session-Id": sid, "Mcp-Protocol-Version": "2025-11-25" });

    const stream = new AbortController();
    const open = await fetch(`${h.base}/mcp`, { headers: headers(token), signal: stream.signal });
    expect(open.status).toBe(200);
    expect(open.headers.get("content-type")).toContain("text/event-stream");
    stream.abort();

    const intruder = await fetch(`${h.base}/mcp`, { headers: headers(await h.mint({ sub: OTHER_USER })) });
    expect(intruder.status).toBe(403);
    const noSession = await fetch(`${h.base}/mcp`, { headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" } });
    expect(noSession.status).toBe(400);
  });

  it("ends a session on DELETE", async () => {
    const token = await h.mint();
    const init = await rpc(h.base, { token, body: INITIALIZE });
    const sid = init.headers.get("mcp-session-id") ?? "";
    const del = await rpc(h.base, { token, sessionId: sid, method: "DELETE", body: null });
    expect(del.status).toBe(200);
    const after = await rpc(h.base, { token, sessionId: sid, body: { jsonrpc: "2.0", id: 2, method: "tools/list" } });
    expect(after.status).toBe(404);
  });
});

describe("http surface", () => {
  it("answers CORS preflight for the host origin and localhost, not for strangers", async () => {
    const preflight = (origin: string) =>
      fetch(`${h.base}/mcp`, {
        method: "OPTIONS",
        headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type,mcp-session-id,mcp-protocol-version" },
      });
    const host = await preflight("http://localhost:3000");
    expect(host.status).toBe(204);
    expect(host.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    expect(host.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("mcp-session-id");
    expect((await preflight("http://localhost:5173")).headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect((await preflight("https://evil.example")).headers.get("access-control-allow-origin")).toBeNull();

    const init = await fetch(`${h.base}/mcp`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await h.mint()}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", Origin: "http://localhost:3000" },
      body: JSON.stringify(INITIALIZE),
    });
    expect(init.headers.get("access-control-expose-headers")).toContain("Mcp-Session-Id");
  });

  it("rejects a request from an unknown browser Origin with 403, before auth", async () => {
    const res = await fetch(`${h.base}/mcp`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await h.mint()}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", Origin: "https://evil.example" },
      body: JSON.stringify(INITIALIZE),
    });
    expect(res.status).toBe(403);
    const allowed = await fetch(`${h.base}/mcp`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await h.mint()}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", Origin: "http://localhost:3000" },
      body: JSON.stringify(INITIALIZE),
    });
    expect(allowed.status).toBe(200);
  });

  it("serves health and media with caching headers", async () => {
    const health = await rest(h.base, "/healthz");
    expect(health.body).toMatchObject({ status: "ok", name: "hearth", version: pkg.version, widgets: 8 });
    const media = await fetch(`${h.base}/media/kitchen-sink-shutoffs.svg`);
    expect(media.status).toBe(200);
    expect(media.headers.get("content-type")).toContain("image/svg+xml");
    expect(media.headers.get("cache-control")).toContain("max-age");
    expect((await fetch(`${h.base}/media/missing.svg`)).status).toBe(404);
  });

  it("reports a malformed JSON body as a JSON-RPC parse error", async () => {
    const res = await fetch(`${h.base}/mcp`, { method: "POST", headers: { Authorization: `Bearer ${await h.mint()}`, "Content-Type": "application/json" }, body: "{not json" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ jsonrpc: "2.0", error: { code: -32700 } });
  });
});
