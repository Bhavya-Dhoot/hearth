import type { AssetType, DeviceClass } from "@hearth/contracts";
import type { ToolCallResult } from "./client";

export type Turn =
  | { role: "user"; text: string; source: "voice" | "text" | "tap" }
  | { role: "assistant"; text: string }
  | { role: "tool"; callId: string; name: string; args: Record<string, unknown>; result: ToolCallResult };

export interface QuestionMemo {
  id: string;
  text: string;
  options?: string[];
}

export interface PartMemo {
  sku: string;
  name: string;
  price: number;
  fitReason: string;
  etaDate: string;
}

export interface WeekendMemo {
  id: string;
  title: string;
  why: string;
  assetName: string;
  /** Present only for rows that can go straight to checkout. */
  reorderSku?: string;
}

/** An add_asset request waiting on the customer: a label photo, or a spoken location. */
export interface PendingAsset {
  stage: "photo" | "location";
  type: AssetType;
  category: string;
  label: string;
  brand?: string;
  model?: string;
  serial?: string;
  installYear?: number;
  photoUrl?: string;
  /** Room named in the first utterance ("add my water heater in the garage"), if any. */
  room?: string;
  note?: string;
}

export type TradeName = "plumber" | "electrician" | "hvac" | "appliance" | "gas_utility" | "general";

/**
 * Everything the rules orchestrator needs to carry between turns. JSON-serialisable: nothing but strings,
 * numbers, booleans, arrays, plain objects and null.
 */
export interface RulesMemory {
  /** The problem as the customer described it; re-sent to triage_issue with each answer. */
  symptomText: string | null;
  /** questionId -> the customer's answer. */
  answers: Record<string, string>;
  /** Clarifying questions not yet answered. Index 0 is the one most recently asked. */
  pendingQuestions: QuestionMemo[];
  suspectedAssetId: string | null;
  trade: TradeName | null;
  /** Active repair, from the last triage leaf and repair step. */
  issue: {
    issueId: string;
    issueTitle: string;
    stepIndex: number;
    stepCount: number;
    isLast: boolean;
    lastInstruction: string | null;
  } | null;
  /** Instructions the customer has already moved past for the current problem; goes into the pro brief. */
  attempted: string[];
  /** From the current step: the part the repair needs next. */
  partNeeded: { partRole: string; assetId: string } | null;
  /** Last parts list shown. */
  parts: { partRole: string; items: PartMemo[] } | null;
  /** SKU of the part ordered for the active repair, passed to log_completion. */
  orderedPartSku: string | null;
  /** Set when find_exact_part was called for a reorder: the first result goes straight to checkout. */
  autoOrderFirst: boolean;
  /** The open checkout session. awaitingConfirmation is true only between reading the commitment and the next turn. */
  checkout: {
    sessionId: string;
    sku: string;
    name: string;
    etaDate: string;
    commitmentRead: boolean;
    awaitingConfirmation: boolean;
    forRepair: boolean;
  } | null;
  /** Last weekend plan rows, in the order they were shown. */
  weekend: WeekendMemo[];
  /** Last pro brief prepared. */
  brief: { briefId: string; trade: TradeName; handoffLine: string } | null;
  /** What a bare "yes" answers, when it is not a purchase. */
  offer:
    | { kind: "pro_brief"; symptom: string; issueId: string | null; assetId: string | null; trade: TradeName | null }
    | { kind: "handoff"; trade: TradeName }
    | null;
  pendingAsset: PendingAsset | null;
}

export interface ConversationState {
  turns: Turn[];
  memory: RulesMemory;
  device: DeviceClass;
}

export const createEmptyMemory = (): RulesMemory => ({
  symptomText: null,
  answers: {},
  pendingQuestions: [],
  suspectedAssetId: null,
  trade: null,
  issue: null,
  attempted: [],
  partNeeded: null,
  parts: null,
  orderedPartSku: null,
  autoOrderFirst: false,
  checkout: null,
  weekend: [],
  brief: null,
  offer: null,
  pendingAsset: null,
});

export function createInitialState(device: DeviceClass): ConversationState {
  return { turns: [], memory: createEmptyMemory(), device };
}
