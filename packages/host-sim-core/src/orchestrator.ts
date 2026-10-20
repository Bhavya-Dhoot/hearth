import { UiMeta, WIDGET_PATTERN, WidgetName } from "@hearth/contracts";
import { UnauthorizedError } from "./traffic";
import type { McpHostClient, ToolCallResult, ToolDef } from "./client";
import type { ConversationState, Turn } from "./state";
import { isExplicitYes, parseTapUtterance, stripWakeWord } from "./utterance";

export type OrchestratorDecision =
  | { kind: "tool_calls"; calls: { id: string; name: string; args: Record<string, unknown> }[]; say?: string }
  | { kind: "speak"; text: string; expectReply: boolean };

export interface Orchestrator {
  readonly mode: "bedrock" | "ollama" | "rules";
  step(state: ConversationState, tools: ToolDef[]): Promise<OrchestratorDecision>;
}

export interface ToolCallSummary {
  name: string;
  args: Record<string, unknown>;
  ms: number;
  isError: boolean;
}

export interface RunTurnResult {
  say: string;
  ui?: UiMeta;
  state: ConversationState;
  toolCalls: ToolCallSummary[];
}

export const DEFAULT_MAX_TOOL_CALLS = 4;

/** Upper bound on orchestrator steps in one turn, so a misbehaving orchestrator cannot spin. */
const MAX_STEPS = 12;

const OUT_OF_BUDGET_SAY = "I've done what I can for now. Tell me what you'd like next.";

/* ------------------------------------------------------------------ ui extraction */

const UI_URI = /^ui:\/\/hearth\/(.+)-[0-9a-f]+\.html$/i;

/** `_meta.ui` of a tool result as a UiMeta. Tolerates a server that omits `widget`/`pattern` by deriving them from the URI. */
export function extractUiMeta(result: ToolCallResult): UiMeta | undefined {
  const raw = result._meta?.ui;
  if (typeof raw !== "object" || raw === null) return undefined;
  const strict = UiMeta.safeParse(raw);
  if (strict.success) return strict.data;
  const rec = raw as Record<string, unknown>;
  const uri = typeof rec.resourceUri === "string" ? rec.resourceUri : undefined;
  const name = uri ? UI_URI.exec(uri)?.[1] : undefined;
  const widget = WidgetName.safeParse(rec.widget ?? name);
  if (!uri || !widget.success) return undefined;
  const props = typeof rec.props === "object" && rec.props !== null && !Array.isArray(rec.props) ? (rec.props as Record<string, unknown>) : (result.structuredContent ?? {});
  const derived = UiMeta.safeParse({ resourceUri: uri, pattern: rec.pattern ?? WIDGET_PATTERN[widget.data], widget: widget.data, props });
  return derived.success ? derived.data : undefined;
}

/* ------------------------------------------------------------------ checkout safety */

const notConfirmed = (message: string): ToolCallResult => ({
  content: [{ type: "text", text: message }],
  structuredContent: { error: { code: "not_confirmed", message } },
  isError: true,
  ms: 0,
});

const squash = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * Host-side guard, independent of which orchestrator produced the call. complete_checkout goes out only when:
 *   1. the session id came from a successful create_checkout_session in this conversation,
 *   2. the assistant turn right before this user turn contains that session's commitmentText, and
 *   3. this user turn is an explicit yes, or a tap on confirm_checkout for that session.
 * Otherwise a not_confirmed error is returned to the orchestrator without any network call.
 */
function checkoutGuard(state: ConversationState, userIdx: number, args: Record<string, unknown>): { ok: true; phrase: string } | { ok: false; result: ToolCallResult } {
  const sessionId = typeof args.sessionId === "string" ? args.sessionId : "";
  let commitment: string | undefined;
  for (let i = userIdx - 1; i >= 0; i -= 1) {
    const t = state.turns[i];
    if (t?.role === "tool" && t.name === "create_checkout_session" && !t.result.isError) {
      const sc = t.result.structuredContent;
      if (sc && sc.sessionId === sessionId && typeof sc.commitmentText === "string") {
        commitment = sc.commitmentText;
        break;
      }
    }
  }
  if (!commitment) return { ok: false, result: notConfirmed("No open checkout session matches that id, so I did not place an order.") };

  const prev = state.turns[userIdx - 1];
  if (prev?.role !== "assistant" || !squash(prev.text).includes(squash(commitment))) {
    return { ok: false, result: notConfirmed("The order details were not read to the customer immediately before this reply, so I did not place the order.") };
  }

  const user = state.turns[userIdx];
  if (user?.role !== "user") return { ok: false, result: notConfirmed("There is no customer reply to act on.") };
  const tap = parseTapUtterance(user.text);
  if (tap) {
    if (tap.name === "confirm_checkout" && tap.args.sessionId === sessionId) return { ok: true, phrase: "confirm" };
    return { ok: false, result: notConfirmed("The customer did not confirm this order, so I did not place it.") };
  }
  if (!isExplicitYes(user.text)) return { ok: false, result: notConfirmed("The customer did not say an explicit yes right after the order details, so I did not place the order.") };
  return { ok: true, phrase: stripWakeWord(user.text) };
}

/* ------------------------------------------------------------------ the turn loop */

const errorResult = (message: string): ToolCallResult => ({
  content: [{ type: "text", text: message }],
  structuredContent: { error: { code: "internal", message } },
  isError: true,
  ms: 0,
});

/**
 * One customer turn: append the user turn, then loop orchestrator.step -> callTool until the orchestrator speaks.
 * At most `maxToolCalls` (default 4) tools run per turn. The input state is not mutated; the returned state is a copy.
 */
export async function runTurn(opts: {
  client: Pick<McpHostClient, "callTool">;
  orchestrator: Orchestrator;
  state: ConversationState;
  userText: string;
  source: "voice" | "text" | "tap";
  tools: ToolDef[];
  maxToolCalls?: number;
  onToolResult?: (call: { name: string; args: Record<string, unknown> }, result: ToolCallResult) => void;
}): Promise<RunTurnResult> {
  const max = opts.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  const state: ConversationState = structuredClone(opts.state);
  state.turns.push({ role: "user", text: opts.userText, source: opts.source });
  const userIdx = state.turns.length - 1;

  const said: string[] = [];
  const toolCalls: ToolCallSummary[] = [];
  let ui: UiMeta | undefined;
  let finished = false;

  for (let step = 0; step < MAX_STEPS && !finished; step += 1) {
    const decision = await opts.orchestrator.step(state, opts.tools);

    if (decision.kind === "speak") {
      state.turns.push({ role: "assistant", text: decision.text });
      said.push(decision.text);
      finished = true;
      break;
    }

    if (decision.say) {
      state.turns.push({ role: "assistant", text: decision.say });
      said.push(decision.say);
    }

    for (const call of decision.calls) {
      if (toolCalls.length >= max) break;
      let args = call.args;
      let result: ToolCallResult;

      if (call.name === "complete_checkout") {
        const guard = checkoutGuard(state, userIdx, args);
        if (guard.ok) {
          args = { ...args, userConfirmed: true, confirmationPhrase: guard.phrase };
          result = await invoke(opts.client, call.name, args);
        } else {
          result = guard.result;
        }
      } else {
        result = await invoke(opts.client, call.name, args);
      }

      const turn: Turn = { role: "tool", callId: call.id, name: call.name, args, result };
      state.turns.push(turn);
      toolCalls.push({ name: call.name, args, ms: result.ms, isError: result.isError === true });
      opts.onToolResult?.({ name: call.name, args }, result);
      const meta = result.isError ? undefined : extractUiMeta(result);
      if (meta) ui = meta;
    }

    if (toolCalls.length >= max) {
      // Budget spent: give the orchestrator one chance to speak about what it has, never to call another tool.
      const last = await opts.orchestrator.step(state, opts.tools);
      const text = last.kind === "speak" ? last.text : OUT_OF_BUDGET_SAY;
      state.turns.push({ role: "assistant", text });
      said.push(text);
      finished = true;
    }
  }

  if (!finished) {
    state.turns.push({ role: "assistant", text: OUT_OF_BUDGET_SAY });
    said.push(OUT_OF_BUDGET_SAY);
  }

  return { say: said.join(" ").trim(), ui, state, toolCalls };
}

async function invoke(client: Pick<McpHostClient, "callTool">, name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
  try {
    return await client.callTool(name, args);
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error;
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}
