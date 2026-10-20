import { mediaUrl, Ports, type DeviceClass, type UiMeta } from "@hearth/contracts";
import type { McpHostClient, ToolCallResult, ToolDef } from "./client";
import { runTurn, type Orchestrator, type ToolCallSummary } from "./orchestrator";
import { createInitialState, type ConversationState } from "./state";
import { photoToUtterance } from "./utterance";

export type ReplayId = "J1" | "J2" | "J3" | "J4" | "J5";

export interface ReplayTurn {
  text: string;
  source: "voice" | "tap";
  /** Pause before this turn when played back at human pace. Headless runs may skip it. */
  pauseMs: number;
}

export interface Replay {
  title: string;
  device: DeviceClass;
  turns: ReplayTurn[];
  /** The exact tool sequence the real server calls must produce across the whole replay. */
  expectTools: string[];
}

/** MCP origin for replay media: env in Node (HEARTH_MCP_BASE) or the Next public env in the browser. */
function replayMcpBase(): string {
  const env = typeof process !== "undefined" ? process.env : undefined;
  return env?.HEARTH_MCP_BASE ?? env?.NEXT_PUBLIC_HEARTH_MCP_BASE ?? `http://localhost:${Ports.mcp}`;
}

const LABEL_PHOTO = photoToUtterance({
  photoUrl: mediaUrl(replayMcpBase(), "water-heater-label.svg"),
  brand: "Rheem",
  model: "XE50T10H45U0",
  serial: "RHLN1834567890",
  installYear: 2018,
  room: "Garage",
});

const SYMPTOM = "Alexa, there's water under the kitchen sink.";

/** The five demo journeys (PRD section 4). Every turn drives real tool calls; nothing here is canned output. */
export const REPLAYS: Record<ReplayId, Replay> = {
  J1: {
    title: "Emergency triage: water under the kitchen sink",
    device: "echo-show-8",
    turns: [
      { text: SYMPTOM, source: "voice", pauseMs: 600 },
      { text: "The pipes.", source: "voice", pauseMs: 1400 },
      { text: "Next.", source: "voice", pauseMs: 1800 },
      { text: "Next.", source: "voice", pauseMs: 1800 },
      { text: "Next.", source: "voice", pauseMs: 1800 },
      { text: "Order the first one.", source: "voice", pauseMs: 1600 },
      { text: "Yes.", source: "voice", pauseMs: 1400 },
      { text: "Next.", source: "voice", pauseMs: 1800 },
      { text: "Next.", source: "voice", pauseMs: 1800 },
      { text: "It's fixed.", source: "voice", pauseMs: 1600 },
    ],
    expectTools: [
      "triage_issue",
      "triage_issue",
      "get_repair_steps",
      "get_repair_steps",
      "get_repair_steps",
      "get_repair_steps",
      "find_exact_part",
      "create_checkout_session",
      "complete_checkout",
      "get_repair_steps",
      "get_repair_steps",
      "log_completion",
    ],
  },
  J2: {
    title: "Escalation to a pro: it is the disposal",
    device: "echo-show-8",
    turns: [
      { text: SYMPTOM, source: "voice", pauseMs: 600 },
      { text: "The pipes.", source: "voice", pauseMs: 1400 },
      { text: "Actually, it's coming from the disposal unit itself.", source: "voice", pauseMs: 2200 },
    ],
    expectTools: ["triage_issue", "triage_issue", "get_repair_steps", "triage_issue", "prepare_pro_brief"],
  },
  J3: {
    title: "Weekend plan and one-tap reorder",
    device: "echo-show-15",
    turns: [
      { text: "Alexa, what should I do around the house this weekend?", source: "voice", pauseMs: 600 },
      { text: "Reorder the filter.", source: "voice", pauseMs: 2200 },
      { text: "Yes.", source: "voice", pauseMs: 1400 },
    ],
    expectTools: ["get_weekend_plan", "create_checkout_session", "complete_checkout"],
  },
  J4: {
    title: "Onboarding by voice and label photo",
    device: "phone",
    turns: [
      { text: "Alexa, add my water heater to Hearth.", source: "voice", pauseMs: 600 },
      { text: LABEL_PHOTO, source: "tap", pauseMs: 1800 },
      { text: "The main water shut-off is in the garage, left of the panel.", source: "voice", pauseMs: 2000 },
    ],
    expectTools: ["add_asset", "add_asset"],
  },
  J5: {
    title: "History and recalls",
    device: "echo-show-8",
    turns: [
      { text: "Did we ever fix the disposal?", source: "voice", pauseMs: 600 },
      { text: "Is anything in my house recalled?", source: "voice", pauseMs: 2200 },
    ],
    expectTools: ["get_history", "check_recalls"],
  },
};

export const REPLAY_IDS = Object.keys(REPLAYS) as ReplayId[];

/* ------------------------------------------------------------------ headless runner */

export interface ReplayTurnResult {
  text: string;
  source: "voice" | "tap";
  say: string;
  ui?: UiMeta;
  toolCalls: ToolCallSummary[];
}

export interface ReplayRun {
  id: ReplayId;
  turns: ReplayTurnResult[];
  toolSequence: string[];
  /** Null when the tool sequence matches expectTools; otherwise a one-line description of the first difference. */
  mismatch: string | null;
  state: ConversationState;
}

/** First difference between two tool sequences, or null when they are identical. */
export function compareToolSequence(actual: readonly string[], expected: readonly string[]): string | null {
  const len = Math.max(actual.length, expected.length);
  for (let i = 0; i < len; i += 1) {
    if (actual[i] !== expected[i]) {
      return `call ${i + 1}: expected ${expected[i] ?? "(none)"}, got ${actual[i] ?? "(none)"}`;
    }
  }
  return null;
}

/** Plays one replay turn by turn against a client and an orchestrator. Browser-safe. */
export async function runReplay(opts: {
  id: ReplayId;
  client: Pick<McpHostClient, "callTool">;
  orchestrator: Orchestrator;
  tools: ToolDef[];
  /** When set, called with the pause before each turn; omit to run at full speed. */
  sleep?: (ms: number) => Promise<void>;
  onTurn?: (turn: ReplayTurnResult) => void;
  onToolResult?: (call: { name: string; args: Record<string, unknown> }, result: ToolCallResult) => void;
}): Promise<ReplayRun> {
  const replay = REPLAYS[opts.id];
  let state = createInitialState(replay.device);
  const turns: ReplayTurnResult[] = [];
  const toolSequence: string[] = [];
  for (const t of replay.turns) {
    if (opts.sleep) await opts.sleep(t.pauseMs);
    const out = await runTurn({
      client: opts.client,
      orchestrator: opts.orchestrator,
      state,
      userText: t.text,
      source: t.source,
      tools: opts.tools,
      onToolResult: opts.onToolResult,
    });
    state = out.state;
    const result: ReplayTurnResult = { text: t.text, source: t.source, say: out.say, ui: out.ui, toolCalls: out.toolCalls };
    turns.push(result);
    for (const c of out.toolCalls) toolSequence.push(c.name);
    opts.onTurn?.(result);
  }
  return { id: opts.id, turns, toolSequence, mismatch: compareToolSequence(toolSequence, replay.expectTools), state };
}
