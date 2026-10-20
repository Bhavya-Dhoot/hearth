/**
 * Headless demo replay (PRD 11.4): plays journeys J1 to J5 against a running Hearth MCP server using the same
 * McpHostClient and rules orchestrator as the simulated Alexa+ host. Every tool call is real.
 *
 *   pnpm replay [J1|J2|J3|J4|J5|all]
 *
 * Environment:
 *   HEARTH_MCP_BASE  MCP server origin (default http://localhost:4200)
 *   HEARTH_TOKEN     bearer token; when unset the OAuth link flow in ./lib/link-account mints one
 *
 * Exit code 0 when every replay called exactly the expected tools, 1 otherwise.
 */
import { Ports } from "@hearth/contracts";
import {
  createRulesOrchestrator,
  McpHostClient,
  REPLAYS,
  REPLAY_IDS,
  runReplay,
  UnauthorizedError,
  type ReplayId,
  type ReplayRun,
} from "@hearth/host-sim-core";
import { linkAccount } from "./lib/link-account";

const base = (process.env.HEARTH_MCP_BASE ?? `http://localhost:${Ports.mcp}`).replace(/\/+$/, "");

function parseSelection(arg: string | undefined): ReplayId[] {
  const wanted = (arg ?? "all").toUpperCase();
  if (wanted === "ALL") return REPLAY_IDS;
  const hit = REPLAY_IDS.find((id) => id === wanted);
  if (!hit) {
    console.error(`Unknown replay "${arg}". Use one of ${REPLAY_IDS.join(", ")} or all.`);
    process.exit(2);
  }
  return [hit];
}

async function resolveToken(): Promise<string> {
  const fromEnv = process.env.HEARTH_TOKEN;
  if (fromEnv) return fromEnv;
  console.log("HEARTH_TOKEN is not set; linking an account through the auth server.");
  const token = await linkAccount();
  return token.access_token;
}

const pad = (s: string | number, n: number): string => String(s).padStart(n, " ");
const percentile = (sorted: number[], p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;

async function play(id: ReplayId, token: string): Promise<{ run: ReplayRun; latencies: number[] }> {
  const replay = REPLAYS[id];
  console.log(`\n== ${id}  ${replay.title}  [${replay.device}]`);
  const client = new McpHostClient({ url: `${base}/mcp`, getToken: () => token });
  const init = await client.connect();
  console.log(`   connected to ${init.serverInfo.name} ${init.serverInfo.version}, protocol ${init.protocolVersion}, session ${init.sessionId ?? "none"}`);
  const tools = await client.listTools();
  const orchestrator = createRulesOrchestrator();
  const latencies: number[] = [];
  try {
    const run = await runReplay({
      id,
      client,
      orchestrator,
      tools,
      onTurn: (turn) => {
        console.log(`\n   you (${turn.source}): ${turn.text}`);
        for (const call of turn.toolCalls) {
          latencies.push(call.ms);
          console.log(`     ${call.name.padEnd(24)} ${pad(call.ms, 5)} ms${call.isError ? "  ERROR" : ""}`);
        }
        console.log(`   alexa${turn.ui ? ` [${turn.ui.widget}]` : ""}: ${turn.say}`);
      },
    });
    return { run, latencies };
  } finally {
    await client.close();
  }
}

async function main(): Promise<void> {
  const ids = parseSelection(process.argv[2]);
  console.log(`Hearth demo replay against ${base}/mcp (orchestrator: rules)`);
  const token = await resolveToken();

  let failed = false;
  const summary: string[] = [];
  for (const id of ids) {
    try {
      const { run, latencies } = await play(id, token);
      const sorted = [...latencies].sort((a, b) => a - b);
      if (run.mismatch) {
        failed = true;
        console.log(`\n   FAIL ${id}: tool sequence differs, ${run.mismatch}`);
        console.log(`   expected: ${REPLAYS[id].expectTools.join(", ")}`);
        console.log(`   actual:   ${run.toolSequence.join(", ")}`);
      } else {
        console.log(`\n   PASS ${id}: ${run.toolSequence.length} tool calls in the expected order`);
      }
      summary.push(`${run.mismatch ? "FAIL" : "PASS"}  ${id}  calls ${pad(run.toolSequence.length, 2)}  p50 ${pad(percentile(sorted, 0.5), 4)} ms  max ${pad(sorted[sorted.length - 1] ?? 0, 4)} ms`);
    } catch (error) {
      failed = true;
      const hint = error instanceof UnauthorizedError ? " (token rejected; check HEARTH_TOKEN or the auth server)" : "";
      const message = error instanceof Error ? error.message : String(error);
      console.log(`\n   FAIL ${id}: ${message}${hint}`);
      summary.push(`FAIL  ${id}  ${message}`);
    }
  }

  console.log("\nSummary");
  for (const line of summary) console.log(`  ${line}`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
