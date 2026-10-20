import { NextResponse } from "next/server";
import type { ConversationState, ToolDef } from "@hearth/host-sim-core";
import { describeProvider, orchestrateStep } from "@/server/orchestrate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Which orchestrator would answer right now. Does not call a model. */
export async function GET(req: Request) {
  const prefer = new URL(req.url).searchParams.get("prefer") ?? undefined;
  return NextResponse.json(await describeProvider(prefer));
}

/** One orchestrator step: { state, tools, prefer? } -> { decision, mode, model?, fallbackReason? }. */
export async function POST(req: Request) {
  let body: { state?: ConversationState; tools?: ToolDef[]; prefer?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  if (!body.state || !Array.isArray(body.state.turns) || !Array.isArray(body.tools)) {
    return NextResponse.json({ error: "Expected { state, tools }." }, { status: 400 });
  }
  try {
    return NextResponse.json(await orchestrateStep(body.state, body.tools, body.prefer));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
