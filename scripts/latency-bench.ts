/**
 * Latency benchmark: every tool 50 times against a running Hearth MCP server.
 *
 *   HEARTH_MCP_BASE=http://localhost:4200 HEARTH_AUTH_ISSUER=http://localhost:4100 pnpm bench
 *   pnpm bench -- --read-only        skip the tools that write (add_asset, checkout, brief, log_completion)
 *
 * Times the full round trip as a client sees it (HTTP, JSON-RPC, schema validation, tool).
 * Writes apps/mcp-server/reports/latency.{json,md}. Exits 1 if any tool's p95 is 500 ms or more.
 * Write tools leave test data in the home (50 timeline entries each for briefs and logs, 50 orders).
 * Run it against a scratch data file, or re-seed afterwards.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { FindPartOutput, MCP_PROTOCOL_VERSION, RepairStepsOutput, TOOLS, TriageOutput, type ToolName } from "@hearth/contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { linkAccount } from "./lib/link-account";

const mcpBase = (process.env.HEARTH_MCP_BASE ?? "http://localhost:4200").replace(/\/+$/, "");
const issuer = (process.env.HEARTH_AUTH_ISSUER ?? "http://localhost:4100").replace(/\/+$/, "");
const resource = `${mcpBase}/mcp`;
const reportDir = new URL("../apps/mcp-server/reports/", import.meta.url);

const RUNS = 50;
const WARMUP = 3;
const P95_BUDGET_MS = 500;
const P50_TARGET_MS = 120;
const readOnly = process.argv.includes("--read-only");

const WRITE_TOOLS: ToolName[] = ["add_asset", "create_checkout_session", "complete_checkout", "prepare_pro_brief", "log_completion"];

interface Row {
  tool: ToolName;
  runs: number;
  errors: number;
  p50: number;
  p95: number;
  max: number;
  serverP50: number | null;
  skipped: boolean;
}

const samples = new Map<ToolName, number[]>();
const serverSamples = new Map<ToolName, number[]>();
const errors = new Map<ToolName, number>();
const run = Date.now().toString(36);
let counter = 0;
const key = (label: string): string => `bench-${label}-${run}-${(counter += 1)}`;

const round1 = (n: number): number => Math.round(n * 10) / 10;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? 0;
}

async function timed(client: Client, tool: ToolName, args: Record<string, unknown>, record: boolean): Promise<CallToolResult> {
  const started = performance.now();
  const result = (await client.callTool({ name: tool, arguments: args })) as CallToolResult;
  const elapsed = performance.now() - started;
  if (record) {
    if (result.isError) errors.set(tool, (errors.get(tool) ?? 0) + 1);
    samples.set(tool, [...(samples.get(tool) ?? []), elapsed]);
    const server = (result._meta as Record<string, unknown> | undefined)?.["hearth/serverMs"];
    if (typeof server === "number") serverSamples.set(tool, [...(serverSamples.get(tool) ?? []), server]);
  }
  return result;
}

async function main(): Promise<Row[]> {
  console.log(`Hearth latency bench: ${RUNS} runs per tool${readOnly ? " (read-only)" : ""}\n  MCP server  ${mcpBase}\n  Auth server ${issuer}\n`);
  const token = await linkAccount({ issuer, resource });
  const client = new Client({ name: "hearth-latency-bench", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(resource), { requestInit: { headers: { Authorization: `Bearer ${token.access_token}` } } }));
  console.log(`  connected, protocol ${MCP_PROTOCOL_VERSION}\n`);

  // Discover real inputs from the live data instead of assuming seed ids.
  const symptomText = "there's water under the kitchen sink";
  let triage = TriageOutput.parse((await client.callTool({ name: "triage_issue", arguments: { symptomText } }) as CallToolResult).structuredContent);
  if (!triage.issueId && triage.clarifyingQuestions.length > 0) {
    const answers = Object.fromEntries(triage.clarifyingQuestions.map((q) => [q.id, (q.options?.[0] ?? "pipes").toLowerCase()]));
    triage = TriageOutput.parse((await client.callTool({ name: "triage_issue", arguments: { symptomText, answers } }) as CallToolResult).structuredContent);
  }
  const issueId = triage.issueId;
  if (!issueId) throw new Error("triage did not resolve to a playbook, so there is nothing to benchmark against");
  const answers = Object.fromEntries(triage.clarifyingQuestions.map((q) => [q.id, (q.options?.[0] ?? "pipes").toLowerCase()]));

  const first = RepairStepsOutput.parse((await client.callTool({ name: "get_repair_steps", arguments: { issueId, stepIndex: 0 } }) as CallToolResult).structuredContent);
  let partRole = "";
  let assetId: string | undefined;
  for (let i = 0; i < first.stepCount && !partRole; i += 1) {
    const step = RepairStepsOutput.parse((await client.callTool({ name: "get_repair_steps", arguments: { issueId, stepIndex: i } }) as CallToolResult).structuredContent);
    if (step.partNeeded) {
      partRole = step.partNeeded.partRole;
      assetId = step.partNeeded.assetId;
    }
  }
  if (!partRole) throw new Error(`playbook ${issueId} has no step that needs a part`);
  const parts = FindPartOutput.parse((await client.callTool({ name: "find_exact_part", arguments: { assetId, partRole } }) as CallToolResult).structuredContent);
  const sku = parts.items[0]?.sku;
  if (!sku) throw new Error("find_exact_part returned no items");

  const stepCount = first.stepCount;
  /** One timed call (or pair, for checkout). `n` is the iteration, `record` is false for warm-up. */
  type Scenario = (n: number, record: boolean) => Promise<void>;
  const call = (tool: ToolName, args: Record<string, unknown>): Scenario => async (_n, record) => void (await timed(client, tool, args, record));
  const scenarios: Record<ToolName, Scenario> = {
    get_home_profile: call("get_home_profile", {}),
    add_asset: async (_n, record) =>
      void (await timed(client, "add_asset", { type: "fixture", category: "bench_probe", label: "benchmark marker", location: { room: "Garage" }, idempotencyKey: key("asset") }, record)),
    triage_issue: call("triage_issue", { symptomText, answers }),
    get_repair_steps: async (n, record) => void (await timed(client, "get_repair_steps", { issueId, stepIndex: n % stepCount }, record)),
    find_exact_part: call("find_exact_part", { assetId, partRole }),
    create_checkout_session: async (_n, record) => {
      const created = await timed(client, "create_checkout_session", { sku, qty: 1, idempotencyKey: key("create") }, record);
      const sessionId = (created.structuredContent as { sessionId?: string } | undefined)?.sessionId;
      if (sessionId) await timed(client, "complete_checkout", { sessionId, userConfirmed: true, confirmationPhrase: "yes", idempotencyKey: key("done") }, record);
    },
    complete_checkout: async () => undefined, // measured inside the create step, so every completion has a fresh session
    prepare_pro_brief: async (_n, record) =>
      void (await timed(client, "prepare_pro_brief", { issueId, symptom: "Latency benchmark probe, please ignore", idempotencyKey: key("brief") }, record)),
    get_weekend_plan: call("get_weekend_plan", {}),
    log_completion: async (_n, record) =>
      void (await timed(client, "log_completion", { kind: "maintenance", summary: "Latency benchmark probe", idempotencyKey: key("log") }, record)),
    get_history: call("get_history", { query: "disposal" }),
    check_recalls: call("check_recalls", {}),
  };

  for (const spec of TOOLS) {
    const tool = spec.name;
    if (tool === "complete_checkout" || (readOnly && WRITE_TOOLS.includes(tool))) continue;
    process.stdout.write(`  ${tool.padEnd(26)}`);
    const scenario = scenarios[tool];
    for (let n = 0; n < WARMUP; n += 1) await scenario(n, false);
    for (let n = 0; n < RUNS; n += 1) await scenario(n, true);
    const s = [...(samples.get(tool) ?? [])].sort((a, b) => a - b);
    console.log(`p50 ${round1(percentile(s, 0.5))} ms   p95 ${round1(percentile(s, 0.95))} ms`);
  }
  const done = [...(samples.get("complete_checkout") ?? [])].sort((a, b) => a - b);
  if (done.length > 0) console.log(`  ${"complete_checkout".padEnd(26)}p50 ${round1(percentile(done, 0.5))} ms   p95 ${round1(percentile(done, 0.95))} ms`);
  await client.close();

  return TOOLS.map((spec): Row => {
    const s = [...(samples.get(spec.name) ?? [])].sort((a, b) => a - b);
    const server = [...(serverSamples.get(spec.name) ?? [])].sort((a, b) => a - b);
    return {
      tool: spec.name,
      runs: s.length,
      errors: errors.get(spec.name) ?? 0,
      p50: round1(percentile(s, 0.5)),
      p95: round1(percentile(s, 0.95)),
      max: round1(s[s.length - 1] ?? 0),
      serverP50: server.length > 0 ? round1(percentile(server, 0.5)) : null,
      skipped: s.length === 0,
    };
  });
}

function verdict(r: Row): "pass" | "fail" | "skipped" {
  if (r.skipped) return "skipped";
  return r.p95 >= P95_BUDGET_MS || r.errors > 0 ? "fail" : "pass";
}

function markdown(rows: Row[], at: string): string {
  const lines = rows.map(
    (r) =>
      `| \`${r.tool}\` | ${r.skipped ? "-" : r.runs} | ${r.skipped ? "-" : r.p50} | ${r.skipped ? "-" : r.p95} | ${r.skipped ? "-" : r.max} | ${r.serverP50 ?? "-"} | ${r.errors} | ${verdict(r).toUpperCase()} |`,
  );
  const measured = rows.filter((r) => !r.skipped);
  const worst = Math.max(0, ...measured.map((r) => r.p95));
  return [
    "# Hearth latency report",
    "",
    `Run at ${at} against ${mcpBase}. ${RUNS} timed calls per tool after ${WARMUP} warm-up calls, full client round trip, times in milliseconds.`,
    "",
    `Budget: p95 under ${P95_BUDGET_MS} ms (hard), p50 under ${P50_TARGET_MS} ms (target). Worst p95 in this run: ${worst} ms.`,
    "",
    "| Tool | Runs | p50 | p95 | max | Server p50 | Errors | Result |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...lines,
    "",
    "`complete_checkout` is measured in create and complete pairs, so it has the same run count as `create_checkout_session`.",
    "",
  ].join("\n");
}

let rows: Row[] = [];
let crashed = false;
try {
  rows = await main();
} catch (err) {
  crashed = true;
  console.error(`\nBenchmark could not run: ${err instanceof Error ? err.message : String(err)}`);
}

if (rows.length > 0) {
  const at = new Date().toISOString();
  console.log("");
  console.log(`${"TOOL".padEnd(26)}${"RUNS".padStart(5)}${"P50".padStart(9)}${"P95".padStart(9)}${"MAX".padStart(9)}  RESULT`);
  for (const r of rows) {
    console.log(`${r.tool.padEnd(26)}${String(r.skipped ? "-" : r.runs).padStart(5)}${String(r.skipped ? "-" : r.p50).padStart(9)}${String(r.skipped ? "-" : r.p95).padStart(9)}${String(r.skipped ? "-" : r.max).padStart(9)}  ${verdict(r).toUpperCase()}`);
  }
  await mkdir(fileURLToPath(reportDir), { recursive: true });
  await writeFile(
    new URL("latency.json", reportDir),
    JSON.stringify({ generatedAt: at, mcpBase, runsPerTool: RUNS, warmupRuns: WARMUP, p95BudgetMs: P95_BUDGET_MS, p50TargetMs: P50_TARGET_MS, readOnly, results: rows.map((r) => ({ ...r, result: verdict(r) })) }, null, 2),
  );
  await writeFile(new URL("latency.md", reportDir), markdown(rows, at));
  console.log("\nReports written to apps/mcp-server/reports/latency.{json,md}");
}

const failed = crashed || rows.some((r) => verdict(r) === "fail");
if (failed && !crashed) console.error(`At least one tool missed the ${P95_BUDGET_MS} ms p95 budget or returned errors.`);
process.exit(failed ? 1 : 0);
