import {
  CompleteCheckoutOutput,
  CreateCheckoutOutput,
  DEVICE_CONTEXTS,
  FindPartOutput,
  HistoryOutput,
  HomeProfileOutput,
  LogCompletionOutput,
  ProBriefOutput,
  RecallsOutput,
  RepairStepsOutput,
  ToolError,
  TriageOutput,
  WeekendPlanOutput,
  type AssetType,
  type WidgetAction,
} from "@hearth/contracts";
import type { z } from "zod";
import type { ToolCallResult, ToolDef } from "./client";
import type { Orchestrator, OrchestratorDecision } from "./orchestrator";
import type { ConversationState, PendingAsset, PartMemo, RulesMemory, TradeName, Turn } from "./state";
import {
  capFirst,
  lowerFirst,
  ensureEnd,
  isExplicitYes,
  isNo,
  isOfferYes,
  longDate,
  money,
  normalizeText,
  parsePhotoUtterance,
  parseTapUtterance,
  stripWakeWord,
  type LabelPhoto,
} from "./utterance";

/**
 * Deterministic implementation of PRD Appendix E. It drives the real tools and speaks only facts found in
 * tool results. Used when no LLM credentials exist and for reproducible demo replays.
 */

export interface RulesOptions {
  now?: () => Date;
  /** Idempotency keys and call ids. Defaults to time plus randomness; tests inject a counter. */
  newKey?: (prefix: string) => string;
}

export function createRulesOrchestrator(opts: RulesOptions = {}): Orchestrator {
  const now = opts.now ?? (() => new Date());
  const newKey = opts.newKey ?? ((prefix: string) => `${prefix}-${now().getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  return {
    mode: "rules",
    async step(state: ConversationState, tools: ToolDef[]): Promise<OrchestratorDecision> {
      return new Brain(state, tools, newKey).decide();
    },
  };
}

/* ------------------------------------------------------------------ language tables */

const ORDINALS: Record<string, number> = {
  first: 0, "1st": 0, one: 0, "1": 0,
  second: 1, "2nd": 1, two: 1, "2": 1,
  third: 2, "3rd": 2, three: 2, "3": 2,
  fourth: 3, "4th": 3, four: 3, "4": 3,
  fifth: 4, "5th": 4, five: 4, "5": 4,
};
const ORDINAL_WORDS = "first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|one|two|three|four|five";

const PROBLEM =
  /\b(leak\w*|drip\w*|water under|puddle|flood\w*|overflow\w*|clog\w*|slow drain|backed up|won'?t drain|not draining|running toilet|toilet|noise|noisy|hum\w*|buzz\w*|grind\w*|rattl\w*|bang\w*|breaker|tripp\w*|no power|power out|outlet|sparks?|smell\w*|gas|smoke|burning|sewage|sewer|not working|broken|stopped working|won'?t (?:start|turn|heat|cool|run|work|flush)|no heat|no hot water|not (?:heating|cooling)|chirp\w*|beep\w*|jam\w*|mold|crack\w*|sagging|disposal|dishwasher|sink|faucet|furnace|heater|thermostat|fridge|refrigerator|washer|dryer|pipe\w*|drain\w*|ceiling|water)\b/;

const CORRECTION = /^(?:actually|no wait|wait|sorry|correction|turns out)\b|\b(?:it'?s|it is|that'?s) (?:actually )?(?:coming|leaking|dripping|from|the)\b/;

interface ThingSpec {
  match: RegExp;
  type: AssetType;
  category: string;
  label: string;
  needsLabel: boolean;
}

const THINGS: ThingSpec[] = [
  { match: /water heater/, type: "appliance", category: "water_heater", label: "water heater", needsLabel: true },
  { match: /dishwasher/, type: "appliance", category: "dishwasher", label: "dishwasher", needsLabel: true },
  { match: /refrigerator|fridge/, type: "appliance", category: "fridge", label: "refrigerator", needsLabel: true },
  { match: /washing machine|washer/, type: "appliance", category: "washing_machine", label: "washing machine", needsLabel: true },
  { match: /dryer/, type: "appliance", category: "dryer", label: "dryer", needsLabel: true },
  { match: /disposal/, type: "appliance", category: "disposal", label: "garbage disposal", needsLabel: true },
  { match: /furnace/, type: "hvac", category: "furnace", label: "furnace", needsLabel: true },
  { match: /air conditioner|a\/c|\bac\b|condenser/, type: "hvac", category: "ac_condenser", label: "air conditioner", needsLabel: true },
  { match: /shut.?off|shutoff|valve/, type: "shutoff", category: "shutoff", label: "shut-off valve", needsLabel: false },
  { match: /electrical panel|breaker box|\bpanel\b/, type: "panel", category: "electrical_panel", label: "electrical panel", needsLabel: false },
];

const TRADE_NOUN: Record<TradeName, string> = {
  plumber: "a plumber",
  electrician: "an electrician",
  hvac: "an HVAC technician",
  appliance: "an appliance technician",
  gas_utility: "your gas utility",
  general: "a pro",
};

const HARD_STOP_FALLBACK = "Stop. I can't walk you through this one safely.";

/* ------------------------------------------------------------------ intents */

type Intent =
  | { kind: "tap"; action: WidgetAction }
  | { kind: "photo"; photo: LabelPhoto }
  | { kind: "cancel" }
  | { kind: "weekend" }
  | { kind: "recalls" }
  | { kind: "profile" }
  | { kind: "history"; query: string | null; ever: boolean }
  | { kind: "add"; thing: string; room: string | null }
  | { kind: "statement"; subject: string; location: string }
  | { kind: "reorder"; keyword: string | null; ordinal: number | null }
  | { kind: "order"; ordinal: number }
  | { kind: "done" }
  | { kind: "next" }
  | { kind: "pro" }
  | { kind: "problem" }
  | { kind: "unknown" };

/** Intents that are about something new and so override a half-finished question or asset capture. */
const GLOBAL_KINDS: ReadonlySet<Intent["kind"]> = new Set<Intent["kind"]>(["tap", "weekend", "recalls", "profile", "history", "add", "statement", "reorder", "order", "pro"]);

function ordinalIn(n: string): number | null {
  const m = new RegExp(`\\b(${ORDINAL_WORDS})\\b`).exec(n);
  const idx = m?.[1] !== undefined ? ORDINALS[m[1]] : undefined;
  return idx ?? null;
}

function lastKeyword(phrase: string): string | null {
  const words = phrase.split(/\s+/).filter((w) => w !== "" && !/^(?:it|that|this|one|ones|the|my|our|a|an|another|more|some)$/.test(w) && !new RegExp(`^(?:${ORDINAL_WORDS})$`).test(w));
  const w = words[words.length - 1];
  if (!w) return null;
  return w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w;
}

function classify(raw: string, n: string): Intent {
  const tap = parseTapUtterance(raw);
  if (tap) return { kind: "tap", action: tap };
  const photo = parsePhotoUtterance(raw);
  if (photo) return { kind: "photo", photo };

  if (/^(?:never ?mind|forget it|stop|cancel(?: that)?|no thanks|no thank you|nothing)$/.test(n)) return { kind: "cancel" };

  if (/\brecall(?:s|ed)?\b/.test(n)) return { kind: "recalls" };
  if (/(?:this weekend|the weekend|around the house)/.test(n) && /\b(?:what|anything|should|plan|do)\b/.test(n)) return { kind: "weekend" };
  if (/\b(?:know|remember)\b.*\b(?:my|our) (?:house|home)\b/.test(n) || /\bwhat'?s in my (?:house|home)\b/.test(n)) return { kind: "profile" };

  const hist = /^(?:did|have) we (ever )?(.*)$/.exec(n);
  if (hist || /\bwhen did we (?:last )?/.test(n) || /\b(?:history|timeline)\b/.test(n) || /\blast time we\b/.test(n)) {
    const verb = /(?:fix|fixed|repair|repaired|replace|replaced|change|changed|service|serviced|clean|cleaned|look at|looked at|call (?:someone|a \w+) (?:about|for))\s+(.+)$/.exec(n);
    return { kind: "history", query: verb?.[1] ? lastKeyword(verb[1]) : null, ever: hist?.[1] !== undefined };
  }

  const add = /^add (?:my|our|the|a) (.+?)(?: to (?:hearth|my home|the house|my house))?$/.exec(n);
  if (add?.[1]) {
    const inRoom = /^(.+?)\s+(?:in|at) (?:the |my )?(.+)$/.exec(add[1]);
    return inRoom?.[1] ? { kind: "add", thing: inRoom[1], room: inRoom[2] ?? null } : { kind: "add", thing: add[1], room: null };
  }

  const stmt = /^(?:the |my |our )?(.+?)\s+(?:is|are|'s)\s+(?:located\s+)?(?:in|at|by|near|under|inside)\s+(.+)$/.exec(n);
  if (stmt?.[1] && stmt[2] && THINGS.some((t) => !t.needsLabel && t.match.test(stmt[1] ?? ""))) {
    return { kind: "statement", subject: stmt[1], location: stmt[2] };
  }

  const re = /\bre-?order\b\s*(.*)$/.exec(n) ?? /\b(?:order|buy|get) (?:more|another|a new|some more)\b\s*(.*)$/.exec(n);
  if (re) {
    const phrase = re[1] ?? "";
    return { kind: "reorder", keyword: lastKeyword(phrase), ordinal: ordinalIn(phrase) };
  }

  if (/\b(?:find|get|call|need|want) (?:me )?(?:a |an )?(?:pro|plumber|electrician|technician|handyman|professional)\b|\bpro brief\b|\bbrief for\b/.test(n)) return { kind: "pro" };

  const ord = ordinalIn(n);
  if (ord !== null && (/^(?:the )?(?:first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)(?: one)?$/.test(n) || /^(?:number|option) \w+$/.test(n) || /\b(?:order|buy|get|take|want|add|go with|i'?ll take)\b/.test(n))) {
    return { kind: "order", ordinal: ord };
  }
  if (/^(?:order|buy|get) (?:it|that|this)$/.test(n)) return { kind: "order", ordinal: 0 };

  if (/\b(?:it'?s|it is|that|all)\s+(?:fixed|done)\b|^(?:done|finished|fixed|all done|problem solved|that did it|it works(?: now)?|i'?m done)$/.test(n)) return { kind: "done" };
  if (/^(?:next(?: step)?|go on|go ahead|continue|okay|ok|alright|all right|got it|ready|keep going|what'?s next|and then|then what)$/.test(n)) return { kind: "next" };
  if (PROBLEM.test(n) || CORRECTION.test(n)) return { kind: "problem" };
  return { kind: "unknown" };
}

/* ------------------------------------------------------------------ small parsers */

interface Place {
  room: string;
  note?: string;
}

/** "the garage, left of the panel" -> room garage, note "left of the panel". Null when nothing usable is there. */
function parseLocation(text: string): Place | null {
  let t = text.trim().replace(/[.!?]+$/, "");
  t = t.replace(/^(?:it'?s|it is|that'?s|they'?re|its)\s+/i, "");
  t = t.replace(/^(?:located\s+)?(?:in|at|inside|by|near|under|on)\s+/i, "");
  t = t.replace(/^(?:the|my|our)\s+/i, "");
  if (t === "") return null;
  let room = t;
  let note: string | undefined;
  const comma = t.indexOf(",");
  if (comma > 0) {
    room = t.slice(0, comma).trim();
    note = t.slice(comma + 1).trim();
  } else {
    const rel = /^(.+?)\s+((?:next to|left of|right of|behind|beside|under|above|near|by)\b.*)$/i.exec(t);
    if (rel?.[1] && rel[2]) {
      room = rel[1].trim();
      note = rel[2].trim();
    }
  }
  if (room.length < 2 || room.length > 40) return null;
  return note ? { room: capFirst(room), note } : { room: capFirst(room) };
}

function findThing(text: string): ThingSpec | undefined {
  return THINGS.find((t) => t.match.test(text));
}

const compact = <T extends Record<string, unknown>>(obj: T): T => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;

function resolveAnswer(raw: string, options: string[] | undefined): string {
  const n = normalizeText(raw);
  if (options) {
    const exact = options.find((o) => normalizeText(o) === n);
    if (exact) return exact;
    const partial = options.find((o) => {
      const on = normalizeText(o);
      return on !== "" && (n.includes(on) || (n.length >= 3 && on.includes(n)));
    });
    if (partial) return partial;
  }
  return stripWakeWord(raw).replace(/[.!?]+$/, "");
}

const roomPhrase = (room: string): string => {
  const r = room.toLowerCase();
  return /^(?:the|my|our)\s/.test(r) ? r : `the ${r}`;
};

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/* ------------------------------------------------------------------ the brain */

class Brain {
  private readonly mem: RulesMemory;
  private readonly voiceOnly: boolean;

  constructor(
    private readonly state: ConversationState,
    private readonly tools: ToolDef[],
    private readonly newKey: (prefix: string) => string,
  ) {
    this.mem = state.memory;
    this.voiceOnly = state.device === "voice-only";
  }

  /* ---- decision helpers ---- */

  private speak(text: string, expectReply: boolean): OrchestratorDecision {
    return { kind: "speak", text: text.trim(), expectReply };
  }

  private call(name: string, args: Record<string, unknown>, say?: string): OrchestratorDecision {
    if (this.tools.length > 0 && !this.tools.some((t) => t.name === name)) {
      return this.speak("Hearth isn't offering that right now. Please try again in a moment.", false);
    }
    return { kind: "tool_calls", calls: [{ id: this.newKey("call"), name, args: compact(args) }], say };
  }

  decide(): OrchestratorDecision {
    const last = this.state.turns[this.state.turns.length - 1];
    if (!last) return this.speak("I'm here. What's going on at home?", true);
    if (last.role === "user") return this.afterUser(last.text);
    if (last.role === "tool") return this.afterTool(last);
    return this.speak("What would you like to do next?", true);
  }

  /* ---- user turns ---- */

  private afterUser(text: string): OrchestratorDecision {
    const mem = this.mem;
    const raw = stripWakeWord(text);
    const n = normalizeText(text);
    const intent = classify(text, n);

    // 1. Purchases: only an explicit yes (or a tap on confirm) straight after the commitment places an order.
    const co = mem.checkout;
    if (co?.awaitingConfirmation) {
      co.awaitingConfirmation = false;
      const tap = intent.kind === "tap" ? intent.action : null;
      const confirmed = tap ? tap.name === "confirm_checkout" && tap.args.sessionId === co.sessionId : isExplicitYes(text);
      if (confirmed && co.commitmentRead) {
        return this.call("complete_checkout", {
          sessionId: co.sessionId,
          userConfirmed: true,
          confirmationPhrase: tap ? "confirm" : raw,
          idempotencyKey: this.newKey("complete"),
        });
      }
      mem.checkout = null;
      const declined = tap ? tap.name === "cancel_checkout" : isNo(text);
      if (declined) return this.speak("Okay, I won't place that order. Nothing was charged.", false);
    }

    // 2. A pending offer ("want me to put together a brief?") takes a plain yes or no.
    if (mem.offer) {
      const offer = mem.offer;
      mem.offer = null;
      if (intent.kind !== "tap") {
        if (isOfferYes(text)) return this.acceptOffer(offer);
        if (isNo(text)) return this.speak("Okay.", false);
      }
    }

    // 3. Half-finished captures and questions take the reply unless the customer moved on to something new.
    if (mem.pendingAsset && !GLOBAL_KINDS.has(intent.kind)) return this.continueAsset(intent, raw);
    if (mem.pendingQuestions.length > 0 && !GLOBAL_KINDS.has(intent.kind)) return this.continueQuestions(intent, raw);
    mem.pendingAsset = null;
    mem.pendingQuestions = [];

    switch (intent.kind) {
      case "tap":
        return this.handleTap(intent.action);
      case "photo":
        return this.speak("I can read a label photo once you've asked me to add something, for example, add my water heater.", false);
      case "cancel":
        return this.speak("Okay.", false);
      case "weekend":
        return this.call("get_weekend_plan", {});
      case "recalls":
        return this.call("check_recalls", {});
      case "profile":
        return this.call("get_home_profile", {});
      case "history":
        return this.call("get_history", { query: intent.query ?? undefined });
      case "add":
        return this.startAdd(intent.thing, intent.room);
      case "statement":
        return this.addStatement(intent.subject, intent.location);
      case "reorder":
        return this.handleReorder(intent.keyword, intent.ordinal);
      case "order":
        return this.handleOrder(intent.ordinal);
      case "done":
        return this.handleDone();
      case "next":
        return this.handleNext(false);
      case "pro":
        return this.handlePro();
      case "problem":
        return this.startTriage(raw);
      case "unknown":
        return this.speak("I can help with a home problem, your weekend plan, recalls, or your home history. What's going on?", true);
    }
  }

  private startTriage(raw: string): OrchestratorDecision {
    const mem = this.mem;
    const corrective = mem.symptomText !== null && mem.issue !== null && CORRECTION.test(normalizeText(raw));
    let symptom = raw;
    if (corrective && mem.symptomText) {
      const cleaned = raw.replace(/^(?:actually|no wait|wait|sorry|correction|turns out)[\s,.:;-]*/i, "");
      symptom = `${ensureEnd(mem.symptomText)} ${capFirst(cleaned)}`;
    } else {
      mem.attempted = [];
      mem.orderedPartSku = null;
    }
    mem.symptomText = symptom;
    mem.answers = {};
    mem.pendingQuestions = [];
    mem.issue = null;
    mem.partNeeded = null;
    mem.parts = null;
    mem.suspectedAssetId = null;
    return this.call("triage_issue", { symptomText: symptom });
  }

  private continueQuestions(intent: Intent, raw: string): OrchestratorDecision {
    const mem = this.mem;
    if (intent.kind === "cancel") {
      mem.pendingQuestions = [];
      return this.speak("Okay, I'll set that aside.", false);
    }
    const q = mem.pendingQuestions[0];
    if (!q) return this.speak("What's going on?", true);
    mem.answers[q.id] = resolveAnswer(raw, q.options);
    mem.pendingQuestions = mem.pendingQuestions.slice(1);
    const next = mem.pendingQuestions[0];
    if (next) return this.speak(next.text, true);
    return this.call("triage_issue", {
      symptomText: mem.symptomText ?? raw,
      answers: { ...mem.answers },
      suspectedAssetId: mem.suspectedAssetId ?? undefined,
    });
  }

  private handleNext(skip: boolean): OrchestratorDecision {
    const mem = this.mem;
    const issue = mem.issue;
    if (!issue) return this.speak("There's no repair in progress. Tell me what's going wrong and I'll walk you through it.", true);
    if (issue.isLast || (issue.stepCount > 0 && issue.stepIndex + 1 >= issue.stepCount)) {
      return this.speak("That was the last step. Say done once it's fixed, or ask me to prepare a brief for a pro.", true);
    }
    if (!skip && issue.lastInstruction && !mem.attempted.includes(issue.lastInstruction)) mem.attempted.push(issue.lastInstruction);
    return this.call("get_repair_steps", { issueId: issue.issueId, stepIndex: issue.stepIndex + 1 });
  }

  private handleDone(issueIdFromTap?: string): OrchestratorDecision {
    const mem = this.mem;
    const issueId = issueIdFromTap ?? mem.issue?.issueId;
    if (!issueId) return this.speak("I don't have a repair in progress to log. Tell me what you finished and I'll note it.", false);
    const title = mem.issue?.issueTitle ?? issueId;
    return this.call("log_completion", {
      kind: "repair",
      summary: `Finished the repair: ${title}`,
      issueId,
      assetId: mem.suspectedAssetId ?? mem.partNeeded?.assetId,
      partSku: mem.orderedPartSku ?? undefined,
      idempotencyKey: this.newKey("log"),
    });
  }

  private handlePro(): OrchestratorDecision {
    const mem = this.mem;
    const symptom = mem.symptomText ?? mem.issue?.issueTitle;
    if (!symptom) return this.speak("Tell me what's going wrong and I'll put the brief together.", true);
    return this.proBrief(symptom, mem.issue?.issueId ?? null, mem.suspectedAssetId);
  }

  private proBrief(symptom: string, issueId: string | null, assetId: string | null): OrchestratorDecision {
    return this.call("prepare_pro_brief", {
      issueId: issueId ?? undefined,
      assetId: assetId ?? undefined,
      symptom,
      attempted: this.mem.attempted.length > 0 ? [...this.mem.attempted] : undefined,
      idempotencyKey: this.newKey("brief"),
    });
  }

  private acceptOffer(offer: NonNullable<RulesMemory["offer"]>): OrchestratorDecision {
    if (offer.kind === "pro_brief") return this.proBrief(offer.symptom, offer.issueId, offer.assetId);
    return this.speak("Okay, I'll hand your brief to Home Services.", false);
  }

  /* ---- ordering ---- */

  private handleOrder(ordinal: number): OrchestratorDecision {
    const mem = this.mem;
    const part = mem.parts?.items[ordinal];
    if (part) return this.call("create_checkout_session", { sku: part.sku, qty: 1, idempotencyKey: this.newKey("checkout") });
    const row = mem.weekend[ordinal];
    if (row?.reorderSku) return this.call("create_checkout_session", { sku: row.reorderSku, qty: 1, idempotencyKey: this.newKey("checkout") });
    if (mem.parts) return this.speak(`I only found ${mem.parts.items.length} ${plural(mem.parts.items.length, "option", "options")}. Which one would you like?`, true);
    return this.speak("I haven't shown you any parts yet. Tell me what's wrong or ask for your weekend plan and I'll find the right one.", true);
  }

  private handleReorder(keyword: string | null, ordinal: number | null): OrchestratorDecision {
    const mem = this.mem;
    const rows = mem.weekend.filter((r) => r.reorderSku !== undefined);
    let row = ordinal !== null ? mem.weekend[ordinal] : undefined;
    if (!row?.reorderSku) row = undefined;
    if (!row && keyword) row = rows.find((r) => `${r.title} ${r.assetName} ${r.why}`.toLowerCase().includes(keyword));
    if (!row && !keyword && rows.length > 0) row = rows[0];
    if (row?.reorderSku) return this.call("create_checkout_session", { sku: row.reorderSku, qty: 1, idempotencyKey: this.newKey("checkout") });
    if (keyword === "filter") {
      mem.autoOrderFirst = true;
      return this.call("find_exact_part", { partRole: "furnace_filter" });
    }
    return this.speak("I'm not sure which item you want to reorder. Ask for your weekend plan and I'll list what's due.", true);
  }

  /* ---- taps ---- */

  private handleTap(a: WidgetAction): OrchestratorDecision {
    const mem = this.mem;
    switch (a.name) {
      case "next_step":
      case "skip_step": {
        const prior = mem.issue;
        if (!prior || prior.issueId !== a.args.issueId) {
          mem.issue = { issueId: a.args.issueId, issueTitle: a.args.issueId, stepIndex: a.args.stepIndex, stepCount: 0, isLast: false, lastInstruction: null };
        } else {
          prior.stepIndex = a.args.stepIndex;
        }
        return this.handleNext(a.name === "skip_step");
      }
      case "done":
        return this.handleDone(a.args.issueId);
      case "select_part":
        return this.call("create_checkout_session", { sku: a.args.sku, qty: 1, idempotencyKey: this.newKey("checkout") });
      case "reorder":
        return this.call("create_checkout_session", { sku: a.args.sku, qty: 1, idempotencyKey: this.newKey("checkout") });
      case "confirm_checkout":
        return this.speak("That order isn't open anymore. Say order the first one to start it again.", false);
      case "cancel_checkout":
        mem.checkout = null;
        return this.speak("Okay, I won't place that order. Nothing was charged.", false);
      case "find_pro":
        return this.speak("Okay, I'll hand your brief to Home Services.", false);
      case "open_event":
        return this.call("get_history", {});
    }
  }

  /* ---- adding things to the home ---- */

  private startAdd(thing: string, roomText: string | null): OrchestratorDecision {
    const spec = findThing(thing);
    const label = spec?.label ?? thing;
    const base: PendingAsset = {
      stage: "location",
      type: spec?.type ?? "appliance",
      category: spec?.category ?? thing.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").padEnd(2, "_"),
      label,
    };
    const place = roomText ? parseLocation(roomText) : null;
    const camera = DEVICE_CONTEXTS[this.state.device].deviceCapabilities.camera;
    if (spec?.needsLabel !== false && camera) {
      this.mem.pendingAsset = { ...base, stage: "photo", room: place?.room, note: place?.note };
      return this.speak(`Show me the label on your ${label} and I'll read the brand, model and serial.`, true);
    }
    if (place) return this.addAsset({ ...base, room: place.room, note: place.note });
    this.mem.pendingAsset = base;
    return this.speak(`Which room is your ${label} in?`, true);
  }

  private addStatement(subject: string, location: string): OrchestratorDecision {
    const spec = findThing(subject);
    const place = parseLocation(location);
    if (!spec || !place) return this.speak("Tell me which room it's in and I'll remember it.", true);
    const label = subject.replace(/^(?:the|my|our)\s+/, "");
    const category = spec.type === "shutoff" && /\bmain\b/.test(subject) ? "main_shutoff" : spec.category;
    return this.addAsset({ stage: "location", type: spec.type, category, label, room: place.room, note: place.note });
  }

  private continueAsset(intent: Intent, raw: string): OrchestratorDecision {
    const mem = this.mem;
    const pa = mem.pendingAsset;
    if (!pa) return this.speak("What would you like to add?", true);
    if (intent.kind === "cancel") {
      mem.pendingAsset = null;
      return this.speak("Okay, I won't add it.", false);
    }
    if (pa.stage === "photo") {
      if (intent.kind !== "photo") return this.speak(`I still need a photo of the label on your ${pa.label}. Or say cancel.`, true);
      const p = intent.photo;
      const merged: PendingAsset = {
        ...pa,
        brand: p.brand ?? pa.brand,
        model: p.model ?? pa.model,
        serial: p.serial ?? pa.serial,
        installYear: p.installYear ?? pa.installYear,
        photoUrl: p.photoUrl ?? pa.photoUrl,
        room: p.room ? p.room : pa.room,
      };
      const room = merged.room;
      if (!room) {
        mem.pendingAsset = { ...merged, stage: "location" };
        return this.speak(`I read the label on your ${pa.label}. Which room is it in?`, true);
      }
      return this.addAsset({ ...merged, room });
    }
    const place = parseLocation(raw);
    if (!place) return this.speak(`Which room is your ${pa.label} in?`, true);
    return this.addAsset({ ...pa, room: place.room, note: place.note });
  }

  private addAsset(pa: PendingAsset & { room: string }): OrchestratorDecision {
    return this.call("add_asset", {
      type: pa.type,
      category: pa.category,
      label: pa.label,
      brand: pa.brand,
      model: pa.model,
      serial: pa.serial,
      installYear: pa.installYear,
      location: compact({ room: pa.room, note: pa.note }),
      photoUrl: pa.photoUrl,
      idempotencyKey: this.newKey("asset"),
    });
  }

  /* ---- tool results ---- */

  private parse<S extends z.ZodType>(schema: S, result: ToolCallResult): z.infer<S> | null {
    const parsed = schema.safeParse(result.structuredContent);
    return parsed.success ? parsed.data : null;
  }

  private contentText(result: ToolCallResult): string {
    return result.content
      .map((c) => c.text)
      .filter((t): t is string => typeof t === "string" && t !== "")
      .join(" ");
  }

  private unreadable(result: ToolCallResult): OrchestratorDecision {
    const text = this.contentText(result);
    return this.speak(text !== "" ? ensureEnd(text) : "Hearth sent back something I couldn't read. Please try again.", false);
  }

  private afterTool(turn: Extract<Turn, { role: "tool" }>): OrchestratorDecision {
    const r = turn.result;
    if (r.isError) return this.speakError(turn);
    switch (turn.name) {
      case "triage_issue":
        return this.onTriage(r);
      case "get_repair_steps":
        return this.onSteps(r);
      case "find_exact_part":
        return this.onParts(r);
      case "create_checkout_session":
        return this.onCheckoutCreated(turn);
      case "complete_checkout":
        return this.onCheckoutCompleted(r);
      case "prepare_pro_brief":
        return this.onBrief(r);
      case "get_weekend_plan":
        return this.onWeekend(r);
      case "log_completion":
        return this.onLogged(r);
      case "get_history":
        return this.onHistory(turn);
      case "check_recalls":
        return this.onRecalls(r);
      case "get_home_profile":
        return this.onProfile(r);
      case "add_asset":
        return this.onAdded(turn);
      default:
        return this.unreadable(r);
    }
  }

  private speakError(turn: Extract<Turn, { role: "tool" }>): OrchestratorDecision {
    const code = ToolError.safeParse(turn.result.structuredContent);
    const c = code.success ? code.data.error.code : "internal";
    if (turn.name === "complete_checkout" || turn.name === "create_checkout_session") this.mem.checkout = null;
    switch (c) {
      case "not_confirmed":
        return this.speak("I need a clear yes before I place an order. Nothing was charged.", false);
      case "session_expired":
        return this.speak("That checkout expired and nothing was charged. Say order the first one to start it again.", false);
      case "unauthorized":
      case "forbidden_scope":
        return this.speak("Hearth needs to be linked to your account again before I can do that.", false);
      case "no_home":
        return this.speak("I don't see a home set up in Hearth yet.", false);
      case "invalid_input":
        return this.speak("Hearth couldn't use that request. Tell me a little more and I'll try again.", true);
      case "not_found":
        return this.speak("I couldn't find that in your home's memory.", false);
      case "conflict":
        return this.speak("That changed while I was working on it. Let's try again.", true);
      default:
        return this.speak("Hearth ran into a problem and I couldn't finish that. Please try again in a moment.", false);
    }
  }

  private onTriage(r: ToolCallResult): OrchestratorDecision {
    const mem = this.mem;
    const t = this.parse(TriageOutput, r);
    if (!t) return this.unreadable(r);
    mem.suspectedAssetId = t.suspectedAsset?.assetId ?? mem.suspectedAssetId;
    mem.trade = t.trade ?? null;
    const symptom = mem.symptomText ?? t.issueTitle ?? "home problem";

    if (t.safety.hardStop) {
      mem.issue = null;
      mem.pendingQuestions = [];
      mem.offer = { kind: "pro_brief", symptom, issueId: null, assetId: t.suspectedAsset?.assetId ?? null, trade: t.trade ?? null };
      const message = t.safety.message ?? HARD_STOP_FALLBACK;
      const sep = /[.!?]["')\]]?$/.test(message.trim()) ? " " : ". ";
      return this.speak(`${message}${sep}Want me to put together a brief for ${TRADE_NOUN[t.trade ?? "general"]}?`, true);
    }

    if (t.escalate) {
      mem.pendingQuestions = [];
      return this.proBrief(symptom, t.issueId, t.suspectedAsset?.assetId ?? null);
    }

    if (t.clarifyingQuestions.length > 0) {
      const fresh = t.clarifyingQuestions.filter((q) => mem.answers[q.id] === undefined);
      const first = fresh[0];
      if (first) {
        mem.pendingQuestions = fresh.map((q) => ({ id: q.id, text: q.text, options: q.options }));
        return this.speak(first.text, true);
      }
    }

    if (t.issueId) {
      mem.issue = { issueId: t.issueId, issueTitle: t.issueTitle ?? t.issueId, stepIndex: 0, stepCount: 0, isLast: false, lastInstruction: null };
      return this.call("get_repair_steps", { issueId: t.issueId, stepIndex: 0 });
    }

    mem.offer = { kind: "pro_brief", symptom, issueId: null, assetId: mem.suspectedAssetId, trade: t.trade ?? null };
    return this.speak("I can't match that to one of my repair guides yet. Tell me a bit more, or I can put together a brief for a pro.", true);
  }

  private onSteps(r: ToolCallResult): OrchestratorDecision {
    const mem = this.mem;
    const s = this.parse(RepairStepsOutput, r);
    if (!s) return this.unreadable(r);
    mem.issue = {
      issueId: s.issueId,
      issueTitle: s.issueTitle,
      stepIndex: s.stepIndex,
      stepCount: s.stepCount,
      isLast: s.isLast,
      lastInstruction: s.instruction,
    };
    mem.partNeeded = s.partNeeded ?? null;

    const parts: string[] = [`Step ${s.stepIndex + 1} of ${s.stepCount}: ${ensureEnd(s.instruction)}`];
    if (s.caution) parts.push(`Careful: ${ensureEnd(s.caution)}`);
    if (this.voiceOnly) {
      if (s.detail) parts.push(ensureEnd(s.detail));
      if (s.tools && s.tools.length > 0) parts.push(`You'll need ${s.tools.join(", ")}.`);
    }
    if (s.addHint) parts.push(ensureEnd(s.addHint));

    const alreadyOrdered = s.partNeeded !== undefined && mem.orderedPartSku !== null && mem.parts?.partRole === s.partNeeded.partRole;
    if (alreadyOrdered) parts.push("Your part is already on order.");
    if (s.partNeeded && !alreadyOrdered) {
      mem.autoOrderFirst = false;
      return this.call(
        "find_exact_part",
        { assetId: s.partNeeded.assetId, issueId: s.issueId, partRole: s.partNeeded.partRole },
        parts.join(" "),
      );
    }
    parts.push(s.isLast ? "Say done when it's fixed." : "Say next when you're ready.");
    return this.speak(parts.join(" "), true);
  }

  private onParts(r: ToolCallResult): OrchestratorDecision {
    const mem = this.mem;
    const p = this.parse(FindPartOutput, r);
    if (!p) return this.unreadable(r);
    const items: PartMemo[] = p.items.map((i) => ({ sku: i.sku, name: i.name, price: i.price, fitReason: i.fitReason, etaDate: i.etaDate }));
    mem.parts = { partRole: p.partRole, items };
    const first = items[0];
    if (!first) return this.speak("I couldn't find a part that fits.", false);
    if (mem.autoOrderFirst) {
      mem.autoOrderFirst = false;
      return this.call("create_checkout_session", { sku: first.sku, qty: 1, idempotencyKey: this.newKey("checkout") });
    }
    const parts = [`I found ${first.name} at ${money(first.price)}.`, ensureEnd(capFirst(first.fitReason))];
    if (this.voiceOnly && items.length > 1) {
      parts.push(`I also have ${items.slice(1).map((i) => `${i.name} at ${money(i.price)}`).join(", and ")}.`);
    }
    parts.push('Say "order the first one" and I\'ll set it up.');
    return this.speak(parts.join(" "), true);
  }

  private onCheckoutCreated(turn: Extract<Turn, { role: "tool" }>): OrchestratorDecision {
    const mem = this.mem;
    const c = this.parse(CreateCheckoutOutput, turn.result);
    if (!c) return this.unreadable(turn.result);
    const sku = typeof turn.args.sku === "string" ? turn.args.sku : (c.lineItems[0]?.sku ?? "");
    const forRepair = mem.issue !== null && (mem.parts?.items.some((i) => i.sku === sku) ?? false);
    mem.checkout = {
      sessionId: c.sessionId,
      sku,
      name: c.lineItems[0]?.name ?? sku,
      etaDate: c.etaDate,
      commitmentRead: true,
      awaitingConfirmation: true,
      forRepair,
    };
    const text = c.commitmentText.trim();
    return this.speak(/confirm\?$/i.test(text) ? text : `${text} Confirm?`, true);
  }

  private onCheckoutCompleted(r: ToolCallResult): OrchestratorDecision {
    const mem = this.mem;
    const c = this.parse(CompleteCheckoutOutput, r);
    if (!c) return this.unreadable(r);
    if (mem.checkout?.forRepair) mem.orderedPartSku = mem.checkout.sku;
    mem.checkout = null;
    const eta = /\barriv/i.test(c.summary) ? "" : ` It arrives ${longDate(c.etaDate)}.`;
    return this.speak(`${ensureEnd(c.summary)}${eta}`, false);
  }

  private onBrief(r: ToolCallResult): OrchestratorDecision {
    const mem = this.mem;
    const b = this.parse(ProBriefOutput, r);
    if (!b) return this.unreadable(r);
    mem.brief = { briefId: b.briefId, trade: b.trade, handoffLine: b.handoffLine };
    mem.offer = { kind: "handoff", trade: b.trade };
    mem.issue = null;
    mem.pendingQuestions = [];
    const triage = [...this.state.turns].reverse().find((t): t is Extract<Turn, { role: "tool" }> => t.role === "tool" && t.name === "triage_issue");
    const reason = triage?.result.structuredContent?.["escalateReason"];
    const parts = typeof reason === "string" && reason.length > 0 ? [`This one's past DIY. ${ensureEnd(reason)}`] : [];
    parts.push("I've put together a job brief for the pro.");
    if (this.voiceOnly) parts.push(`It covers your ${b.asset.brand} ${b.asset.model}, ${b.asset.ageYears} ${plural(b.asset.ageYears, "year", "years")} old.`);
    parts.push(ensureEnd(b.handoffLine));
    return this.speak(parts.join(" "), true);
  }

  private onWeekend(r: ToolCallResult): OrchestratorDecision {
    const mem = this.mem;
    const w = this.parse(WeekendPlanOutput, r);
    if (!w) return this.unreadable(r);
    mem.weekend = w.tasks.map((t) => ({ id: t.id, title: t.title, why: t.why, assetName: t.assetName, reorderSku: t.action?.sku }));
    const [a, b] = w.tasks;
    if (!a) return this.speak("Nothing is due around the house this weekend.", false);
    const row = (t: typeof a): string => `${t.title}: ${ensureEnd(t.why)}`;
    const parts = [`Here are your top ${b ? "two" : "one"} for this weekend. First, ${row(a)}`];
    if (b) parts.push(`Second, ${row(b)}`);
    if (a.action || b?.action) parts.push("Say reorder and I'll set it up.");
    return this.speak(parts.join(" "), false);
  }

  private onLogged(r: ToolCallResult): OrchestratorDecision {
    const mem = this.mem;
    const l = this.parse(LogCompletionOutput, r);
    if (!l) return this.unreadable(r);
    mem.issue = null;
    mem.partNeeded = null;
    mem.parts = null;
    mem.orderedPartSku = null;
    mem.attempted = [];
    mem.symptomText = null;
    const parts = ["Done. It's in your home timeline."];
    if (l.nextDue) parts.push(`I'll remind you on ${longDate(l.nextDue.dueDate)}: ${ensureEnd(lowerFirst(l.nextDue.title))}`);
    return this.speak(parts.join(" "), false);
  }

  private onHistory(turn: Extract<Turn, { role: "tool" }>): OrchestratorDecision {
    const h = this.parse(HistoryOutput, turn.result);
    if (!h) return this.unreadable(turn.result);
    const query = typeof turn.args.query === "string" ? turn.args.query : null;
    const ask = [...this.state.turns].reverse().find((t): t is Extract<Turn, { role: "user" }> => t.role === "user");
    const ever = ask ? /^(?:did|have) we ever\b/.test(normalizeText(ask.text)) : false;
    const wantsFix = ask ? /\b(?:fix|fixed|repair|repaired)\b/.test(normalizeText(ask.text)) : false;
    const event = (wantsFix ? h.events.find((e) => e.type === "repair") : undefined) ?? h.events[0];
    if (!event) {
      return this.speak(query ? `I don't have anything about the ${query} in your home timeline.` : "Your home timeline is empty so far.", false);
    }
    const cost = event.cost !== undefined && event.cost > 0 ? ` It cost ${money(event.cost)}.` : "";
    return this.speak(`${ever ? "Yes. " : ""}I have it from ${longDate(event.ts.slice(0, 10), true)}: ${ensureEnd(event.summary)}${cost}`, false);
  }

  private onRecalls(r: ToolCallResult): OrchestratorDecision {
    const rc = this.parse(RecallsOutput, r);
    if (!rc) return this.unreadable(r);
    const label = ensureEnd(rc.datasetLabel);
    const first = rc.flagged[0];
    if (!first) {
      return this.speak(`I checked ${rc.checkedCount} ${plural(rc.checkedCount, "item", "items")} in your home and none are flagged. ${label}`, false);
    }
    const more = rc.flagged.length > 1 ? ` I found ${rc.flagged.length} in all, and this is the first.` : "";
    const parts = [`Your ${first.assetName} is flagged: ${ensureEnd(first.title)}${more}`];
    const step = first.remedy[0];
    if (step) parts.push(`First step: ${ensureEnd(step)}`);
    parts.push(label);
    return this.speak(parts.join(" "), false);
  }

  private onProfile(r: ToolCallResult): OrchestratorDecision {
    const p = this.parse(HomeProfileOutput, r);
    if (!p) return this.unreadable(r);
    if (p.assetCount === 0) return this.speak("Hearth doesn't have anything saved for your home yet. Say add my water heater to start.", true);
    const places = p.keyLocations.slice(0, this.voiceOnly ? 3 : 1).map((k) => `your ${k.label} in ${k.location}`);
    const joined = places.length > 1 ? `${places.slice(0, -1).join(", ")}, and ${places[places.length - 1]}` : places[0];
    return this.speak(`I remember ${p.assetCount} ${plural(p.assetCount, "thing", "things")} in your home${joined ? `, including ${joined}` : ""}.`, false);
  }

  private onAdded(turn: Extract<Turn, { role: "tool" }>): OrchestratorDecision {
    const mem = this.mem;
    const p = this.parse(HomeProfileOutput, turn.result);
    if (!p) return this.unreadable(turn.result);
    mem.pendingAsset = null;
    const loc = turn.args.location;
    const room = typeof loc === "object" && loc !== null && "room" in loc && typeof loc.room === "string" ? loc.room : null;
    const note = typeof loc === "object" && loc !== null && "note" in loc && typeof loc.note === "string" ? loc.note : null;
    const label = p.highlight?.label ?? (typeof turn.args.label === "string" ? turn.args.label : "item");
    const where = room ? ` in ${roomPhrase(room)}${note ? `, ${note}` : ""}` : "";
    const verb = p.highlight?.created === false ? "updated" : "added";
    return this.speak(`I've ${verb} your ${label}${where}. I now remember ${p.assetCount} ${plural(p.assetCount, "thing", "things")} in your home.`, false);
  }
}
