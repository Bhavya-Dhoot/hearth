import { z } from "zod";
import { AssetType, AssetAttributes, EventType } from "./db";
import { IsoDate, IsoDateTime, WidgetName } from "./common";

/**
 * C1 - Tool schemas. All 12 tools. Outputs are exactly the widget props (C2) where a widget exists.
 * Tools are deterministic: no LLM calls inside tools (PRD 7.2).
 */

/* ------------------------------------------------------------------ shared */

export const AssetRef = z.object({ assetId: z.string(), label: z.string() });

export const HomeProfileOutput = z.object({
  homeId: z.string(),
  name: z.string(),
  city: z.string(),
  state: z.string(),
  yearBuilt: z.number(),
  assetCount: z.number().int(),
  inventoryByType: z.record(z.string(), z.number().int()),
  keyLocations: z.array(z.object({
    assetId: z.string(),
    label: z.string(),
    location: z.string(),
    photoUrl: z.string().url().optional(),
  })).max(6),
  recentEvents: z.array(z.object({ ts: IsoDateTime, type: EventType, summary: z.string() })).max(3),
  openIssues: z.array(z.object({ issueRecordId: z.string(), title: z.string(), status: z.string() })),
  /** Set by add_asset so the Home Card can highlight what was just remembered. */
  highlight: z.object({ assetId: z.string(), label: z.string(), created: z.boolean() }).optional(),
});
export type HomeProfileOutput = z.infer<typeof HomeProfileOutput>;

/* ------------------------------------------------------------------ 1 get_home_profile */
export const GetHomeProfileInput = z.object({});
export const GetHomeProfileOutput = HomeProfileOutput;

/* ------------------------------------------------------------------ 2 add_asset */
export const AddAssetInput = z.object({
  type: AssetType,
  category: z.string().min(2),
  label: z.string().min(2),
  brand: z.string().optional(),
  model: z.string().optional(),
  serial: z.string().optional(),
  installYear: z.number().int().min(1900).max(2100).optional(),
  location: z.object({ room: z.string().min(2), note: z.string().optional() }),
  /** Label/valve photo URL. Vision extraction (brand/model/serial) happens in the host before this call. */
  photoUrl: z.string().url().optional(),
  attributes: AssetAttributes.optional(),
  /** If set, updates this asset instead of creating one. */
  assetId: z.string().optional(),
  idempotencyKey: z.string().min(8),
});
export type AddAssetInput = z.infer<typeof AddAssetInput>;
export const AddAssetOutput = HomeProfileOutput; // highlight is always set
export type AddAssetOutput = z.infer<typeof AddAssetOutput>;

/* ------------------------------------------------------------------ 3 triage_issue */
export const SafetyCategory = z.enum(["gas", "electrical", "structural", "flooding", "sewage"]);
export type SafetyCategory = z.infer<typeof SafetyCategory>;

export const TriageInput = z.object({
  symptomText: z.string().min(3),
  /** questionId -> answer text (free text or one of the offered options). */
  answers: z.record(z.string(), z.string()).optional(),
  suspectedAssetId: z.string().optional(),
});
export type TriageInput = z.infer<typeof TriageInput>;

export const ClarifyingQuestion = z.object({ id: z.string(), text: z.string(), options: z.array(z.string()).optional() });
export type ClarifyingQuestion = z.infer<typeof ClarifyingQuestion>;

export const TriageOutput = z.object({
  /** Playbook id when resolved to a leaf; null while questions remain or on hard stop. */
  issueId: z.string().nullable(),
  issueTitle: z.string().optional(),
  confidence: z.number().min(0).max(1),
  clarifyingQuestions: z.array(ClarifyingQuestion).max(2),
  safety: z.object({
    hardStop: z.boolean(),
    /** Read verbatim when hardStop is true. */
    message: z.string().optional(),
    category: SafetyCategory.optional(),
  }),
  escalate: z.boolean(),
  escalateReason: z.string().optional(),
  /** Trade to hand off to when escalating or hard-stopping. */
  trade: z.enum(["plumber", "electrician", "hvac", "appliance", "gas_utility", "general"]).optional(),
  suspectedAsset: AssetRef.optional(),
});
export type TriageOutput = z.infer<typeof TriageOutput>;

/* ------------------------------------------------------------------ 4 get_repair_steps */
export const RepairStepsInput = z.object({ issueId: z.string(), stepIndex: z.number().int().min(0).default(0) });
export type RepairStepsInput = z.infer<typeof RepairStepsInput>;

export const RepairStepsOutput = z.object({
  issueId: z.string(),
  issueTitle: z.string(),
  stepIndex: z.number().int(),
  stepCount: z.number().int(),
  instruction: z.string(),
  detail: z.string().optional(),
  image: z.object({
    url: z.string().url(),
    alt: z.string(),
    isUsersPhoto: z.boolean(),
    annotation: z.object({ x: z.number(), y: z.number(), r: z.number() }).optional(),
  }).optional(),
  /** e.g. "YOUR VALVE · GARAGE" - shown only when isUsersPhoto. */
  locationChip: z.string().optional(),
  caution: z.string().optional(),
  tools: z.array(z.string()).optional(),
  partNeeded: z.object({ partRole: z.string(), assetId: z.string() }).optional(),
  /** When the home graph lacks the asset this step refers to: what to say to add it. */
  addHint: z.string().optional(),
  primaryAction: z.enum(["next", "done"]),
  canSkip: z.boolean(),
  isLast: z.boolean(),
});
export type RepairStepsOutput = z.infer<typeof RepairStepsOutput>;

/* ------------------------------------------------------------------ 5 find_exact_part */
export const FindPartInput = z.object({ assetId: z.string().optional(), issueId: z.string().optional(), partRole: z.string() });
export type FindPartInput = z.infer<typeof FindPartInput>;

export const PartItem = z.object({
  sku: z.string(),
  name: z.string(),
  price: z.number(),
  currency: z.literal("USD"),
  image: z.string().url(),
  fitReason: z.string(),
  confidence: z.number().min(0).max(1),
  etaDate: IsoDate,
  badge: z.enum(["EXACT FIT", "COMPATIBLE"]),
});
export type PartItem = z.infer<typeof PartItem>;

export const FindPartOutput = z.object({
  title: z.string(),
  partRole: z.string(),
  assetLabel: z.string().optional(),
  items: z.array(PartItem).min(1).max(5),
  selectedIndex: z.number().int().min(0).default(0),
});
export type FindPartOutput = z.infer<typeof FindPartOutput>;

/* ------------------------------------------------------------------ 6 create_checkout_session */
export const CreateCheckoutInput = z.object({ sku: z.string(), qty: z.number().int().min(1).max(10), idempotencyKey: z.string().min(8) });
export type CreateCheckoutInput = z.infer<typeof CreateCheckoutInput>;

export const LineItem = z.object({ sku: z.string(), name: z.string(), qty: z.number().int(), unitPrice: z.number() });
export const Totals = z.object({ subtotal: z.number(), tax: z.number(), shipping: z.number(), total: z.number(), currency: z.literal("USD") });

export const CreateCheckoutOutput = z.object({
  state: z.literal("checkout"),
  sessionId: z.string(),
  lineItems: z.array(LineItem),
  totals: Totals,
  etaDate: IsoDate,
  paymentDisplay: z.string(),
  /** Alexa reads this verbatim before asking for a yes. */
  commitmentText: z.string(),
});
export type CreateCheckoutOutput = z.infer<typeof CreateCheckoutOutput>;

/* ------------------------------------------------------------------ 7 complete_checkout */
export const CompleteCheckoutInput = z.object({
  sessionId: z.string(),
  userConfirmed: z.literal(true),
  /** The customer's own words of consent, echoed by the orchestrator ("yes", "confirm"). */
  confirmationPhrase: z.string().min(1),
  idempotencyKey: z.string().min(8),
});
export type CompleteCheckoutInput = z.infer<typeof CompleteCheckoutInput>;

export const CompleteCheckoutOutput = z.object({
  state: z.literal("confirmation"),
  orderId: z.string(),
  orderNumber: z.string(),
  summary: z.string(),
  etaDate: IsoDate,
  receiptUrl: z.string().url(),
  chargedAmount: z.number(),
  supportEmail: z.string().email(),
  emailStatus: z.enum(["sent", "written_to_outbox"]),
  paymentMode: z.enum(["stripe_test", "simulated"]),
  nextSuggestion: z.string().optional(),
});
export type CompleteCheckoutOutput = z.infer<typeof CompleteCheckoutOutput>;

/* ------------------------------------------------------------------ 8 prepare_pro_brief */
export const ProBriefInput = z.object({
  issueId: z.string().optional(),
  assetId: z.string().optional(),
  symptom: z.string().min(3),
  attempted: z.array(z.string()).optional(),
  idempotencyKey: z.string().min(8),
});
export type ProBriefInput = z.infer<typeof ProBriefInput>;

export const ProBriefOutput = z.object({
  briefId: z.string(),
  headline: z.string(),
  trade: z.enum(["plumber", "electrician", "hvac", "appliance", "gas_utility", "general"]),
  asset: z.object({ brand: z.string(), model: z.string(), ageYears: z.number() }),
  symptom: z.string(),
  timeline: z.array(z.object({ ts: z.string(), text: z.string() })),
  attempted: z.array(z.string()),
  accessNotes: z.string(),
  photos: z.array(z.string().url()),
  shareUrl: z.string().url(),
  qrPayload: z.string(),
  /** One sentence for Alexa's hand-off to native Home Services. */
  handoffLine: z.string(),
});
export type ProBriefOutput = z.infer<typeof ProBriefOutput>;

/* ------------------------------------------------------------------ 9 get_weekend_plan */
export const WeekendPlanInput = z.object({ date: IsoDate.optional() });
export const WeekendTask = z.object({
  id: z.string(),
  title: z.string(),
  why: z.string(),
  dueState: z.enum(["overdue", "due", "soon", "seasonal"]),
  minutes: z.number().int(),
  assetName: z.string(),
  action: z.object({ type: z.literal("reorder"), sku: z.string() }).optional(),
});
export type WeekendTask = z.infer<typeof WeekendTask>;
export const WeekendPlanOutput = z.object({ weekendLabel: z.string(), tasks: z.array(WeekendTask).max(6) });
export type WeekendPlanOutput = z.infer<typeof WeekendPlanOutput>;

/* ------------------------------------------------------------------ 10 log_completion */
export const LogCompletionInput = z.object({
  kind: z.enum(["repair", "maintenance"]),
  summary: z.string().min(3),
  issueId: z.string().optional(),
  assetId: z.string().optional(),
  cost: z.number().optional(),
  partSku: z.string().optional(),
  /** Days until the follow-up/next-due task; omitted = playbook/consumable default. */
  nextDueDays: z.number().int().positive().optional(),
  idempotencyKey: z.string().min(8),
});
export type LogCompletionInput = z.infer<typeof LogCompletionInput>;
export const LogCompletionOutput = z.object({
  eventId: z.string(),
  summary: z.string(),
  nextDue: z.object({ taskId: z.string(), dueDate: IsoDate, title: z.string() }).optional(),
});
export type LogCompletionOutput = z.infer<typeof LogCompletionOutput>;

/* ------------------------------------------------------------------ 11 get_history */
export const HistoryInput = z.object({ assetId: z.string().optional(), type: EventType.optional(), query: z.string().optional(), limit: z.number().int().min(1).max(20).default(8) });
export type HistoryInput = z.infer<typeof HistoryInput>;
export const HistoryOutput = z.object({
  title: z.string(),
  events: z.array(z.object({
    eventId: z.string(),
    ts: IsoDateTime,
    type: EventType,
    summary: z.string(),
    assetName: z.string().optional(),
    cost: z.number().optional(),
  })),
});
export type HistoryOutput = z.infer<typeof HistoryOutput>;

/* ------------------------------------------------------------------ 12 check_recalls */
export const RecallsInput = z.object({});
export const RecallsOutput = z.object({
  checkedCount: z.number().int(),
  /** Always disclosed: the demo dataset is a labelled sample, not live CPSC data. */
  datasetLabel: z.string(),
  flagged: z.array(z.object({
    assetId: z.string(),
    assetName: z.string(),
    brand: z.string(),
    model: z.string(),
    recallId: z.string(),
    title: z.string(),
    hazard: z.string(),
    remedy: z.array(z.string()),
    isSample: z.boolean(),
  })),
});
export type RecallsOutput = z.infer<typeof RecallsOutput>;

/* ------------------------------------------------------------------ catalogue */

export type Scope = "home:read" | "home:write" | "orders:write";

export interface ToolSpec {
  name: string;
  title: string;
  /** Written for the orchestrator LLM: when to call, what it returns, what to say next. */
  description: string;
  input: z.ZodObject;
  output: z.ZodObject;
  widget: WidgetName | null;
  scope: Scope;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
}

const R = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const W = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export const TOOLS = [
  {
    name: "get_home_profile",
    title: "Home profile",
    description: "Summarise the customer's home: how many things Hearth remembers, where the key shut-offs and electrical panel are, the last three events, and any open issues. Call when the customer asks what Hearth knows, where something is, or at the start of onboarding. Shows a Home Card. Say one sentence naming the count and one key location.",
    input: GetHomeProfileInput, output: GetHomeProfileOutput, widget: "home-card", scope: "home:read", annotations: R,
  },
  {
    name: "add_asset",
    title: "Remember an appliance, fixture or shut-off",
    description: "Add or update something in the home graph: an appliance, fixture, shut-off valve, electrical panel, HVAC unit or consumable. Call when the customer says 'add my ...' or describes where something is. If the customer provided a label photo, pass photoUrl plus the brand/model/serial you read from it. Returns the updated Home Card with the new item highlighted. Confirm in one sentence using the label and location.",
    input: AddAssetInput, output: AddAssetOutput, widget: "home-card", scope: "home:write", annotations: W,
  },
  {
    name: "triage_issue",
    title: "Triage a home problem",
    description: "ALWAYS call first for any home problem (leak, noise, no heat, breaker, smell, clog). Deterministic rule engine over 12 repair playbooks. Returns at most two clarifyingQuestions: ask them one at a time, then call again with answers keyed by question id. If safety.hardStop is true, read safety.message verbatim, give no steps, and offer prepare_pro_brief. If escalate is true, call prepare_pro_brief. If issueId is set and no hard stop, call get_repair_steps with stepIndex 0. Voice only, no widget.",
    input: TriageInput, output: TriageOutput, widget: null, scope: "home:read", annotations: R,
  },
  {
    name: "get_repair_steps",
    title: "Repair step",
    description: "Return one step of the repair playbook for issueId, personalised with the customer's own shut-off photos and locations. Start at stepIndex 0. When the customer says next / go on / okay or taps NEXT, call again with stepIndex + 1. Read the instruction and, if present, the caution. If partNeeded is set, call find_exact_part. If isLast and the customer says done, call log_completion. Shows a Step Card.",
    input: RepairStepsInput, output: RepairStepsOutput, widget: "step-card", scope: "home:read", annotations: R,
  },
  {
    name: "find_exact_part",
    title: "Find the exact-fit part",
    description: "Find 3 to 5 parts that fit the customer's actual asset for a part role (e.g. ptrap_washer, supply_line, furnace_filter, 9v_battery). Items are ranked; each has a fitReason. Read the first item's name, price and fit reason, and say the customer can order it by number ('the first one'). Never invent parts or prices. Shows a Parts Carousel.",
    input: FindPartInput, output: FindPartOutput, widget: "parts-carousel", scope: "home:read", annotations: R,
  },
  {
    name: "create_checkout_session",
    title: "Start checkout",
    description: "Create a checkout session for a SKU from find_exact_part or get_weekend_plan. Never charges. Returns commitmentText: read it verbatim, then ask 'Confirm?' and wait for an explicit yes. Shows a Checkout Card.",
    input: CreateCheckoutInput, output: CreateCheckoutOutput, widget: "checkout-card", scope: "orders:write", annotations: W,
  },
  {
    name: "complete_checkout",
    title: "Place the order",
    description: "Place the order for a checkout session. Only call after you read commitmentText aloud AND the customer explicitly said yes or confirm in their most recent turn; pass their words as confirmationPhrase and userConfirmed true. Charges the stored payment method and emails a confirmation. Read the summary and the arrival date. Shows the Confirmation Card.",
    input: CompleteCheckoutInput, output: CompleteCheckoutOutput, widget: "checkout-card", scope: "orders:write", annotations: { ...W, destructiveHint: true },
  },
  {
    name: "prepare_pro_brief",
    title: "Prepare a job brief for a pro",
    description: "Build a shareable job brief for a professional: asset model and age, symptom timeline, what the customer already tried, access notes and photos. Call when triage escalates, on a safety hard stop, or when the customer asks for a pro. Summarise in one sentence, then use handoffLine to offer Alexa's Home Services hand-off ('Want me to find a plumber?'). Shows a Pro Brief Card.",
    input: ProBriefInput, output: ProBriefOutput, widget: "pro-brief-card", scope: "home:write", annotations: W,
  },
  {
    name: "get_weekend_plan",
    title: "Weekend plan",
    description: "Ranked maintenance for this weekend from the home's memory: overdue consumables, recalls, seasonal jobs and follow-ups on recent repairs. Call for 'what should I do around the house'. Rows are numbered; read the top two in one sentence each. Rows with action.type reorder can go straight to create_checkout_session with that sku. Shows a Weekend List.",
    input: WeekendPlanInput, output: WeekendPlanOutput, widget: "weekend-list", scope: "home:read", annotations: R,
  },
  {
    name: "log_completion",
    title: "Log a finished job",
    description: "Record a completed repair or maintenance job in the home timeline and schedule the next due date or follow-up. Call when the customer says done / it's fixed after repair steps, or tells you they did a maintenance job. Confirm in one sentence including the next due date if present. Voice only.",
    input: LogCompletionInput, output: LogCompletionOutput, widget: null, scope: "home:write", annotations: W,
  },
  {
    name: "get_history",
    title: "Home timeline",
    description: "Timeline of past repairs, maintenance, orders and escalations, optionally filtered by asset, type, or a keyword like 'disposal'. Call for 'did we ever...', 'when did we last...'. Answer the question in one sentence using the most relevant event. Shows a Timeline List.",
    input: HistoryInput, output: HistoryOutput, widget: "timeline-list", scope: "home:read", annotations: R,
  },
  {
    name: "check_recalls",
    title: "Check recalls",
    description: "Match every asset in the home against the recall dataset. Returns flagged items with hazard and remedy steps. Always mention that the dataset is a labelled sample. Read the flagged item and the first remedy step. Shows a Recall Card.",
    input: RecallsInput, output: RecallsOutput, widget: "recall-card", scope: "home:read", annotations: R,
  },
] as const satisfies readonly ToolSpec[];

export type ToolName = (typeof TOOLS)[number]["name"];
export const TOOL_NAMES = TOOLS.map((t) => t.name) as ToolName[];
export const toolSpec = (name: string): ToolSpec | undefined => TOOLS.find((t) => t.name === name);
