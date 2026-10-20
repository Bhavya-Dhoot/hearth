import { toolSpec, UiMeta, WIDGET_PATTERN } from "@hearth/contracts";
import type { ToolCallResult } from "../src/client";

/**
 * A stand-in for the Hearth MCP server. Inputs are validated with the contract input schemas, and every output
 * is built to pass the contract output schemas, so the orchestrator is tested against contract-valid data.
 */

const MEDIA = "http://localhost:4200/media";
export const GAS_MESSAGE = "Stop. If you smell gas, leave the house and call your gas company from outside. I won't give steps for this.";

const STEPS = [
  { instruction: "Turn off the cold water shut-off valve under your sink", caution: "Turn it clockwise until it stops." },
  { instruction: "Place a bucket under the P-trap and loosen the two slip nuts" },
  { instruction: "Slide the trap off and dry the joint" },
  { instruction: "Replace the slip-joint washer and hand-tighten the nuts", partNeeded: { partRole: "ptrap_washer", assetId: "asset_ptrap_kitchen" } },
  { instruction: "Reseat the trap and tighten the nuts a quarter turn past snug" },
  { instruction: "Open the valve and check the joints for drips", isLast: true },
] as const;

const PARTS = {
  ptrap_washer: [
    { sku: "HR-PT-150-WSH", name: "Hearth 1-1/2 inch slip-joint washer set", price: 4.29, fitReason: "fits your 1½″ slip-joint P-trap, installed 2019", badge: "EXACT FIT" as const },
    { sku: "HR-PT-150-NUT", name: "Hearth 1-1/2 inch slip nut and washer kit", price: 6.49, fitReason: "fits your 1½″ slip-joint P-trap", badge: "EXACT FIT" as const },
    { sku: "HR-PT-125-WSH", name: "Hearth 1-1/4 inch washer set", price: 3.99, fitReason: "compatible with a 1¼″ slip joint", badge: "COMPATIBLE" as const },
  ],
  furnace_filter: [
    { sku: "HR-FLT-16251-M11", name: "16x25x1 MERV 11 furnace filter", price: 18.99, fitReason: "fits your Carrier 59SC2 furnace, 16 by 25 by 1", badge: "EXACT FIT" as const },
    { sku: "HR-FLT-16251-M8", name: "16x25x1 MERV 8 furnace filter", price: 12.99, fitReason: "fits your Carrier 59SC2 furnace, 16 by 25 by 1", badge: "COMPATIBLE" as const },
    { sku: "HR-FLT-16251-M13", name: "16x25x1 MERV 13 furnace filter", price: 24.99, fitReason: "fits your Carrier 59SC2 furnace, 16 by 25 by 1", badge: "COMPATIBLE" as const },
  ],
} as const;

const PRICES = new Map<string, { name: string; price: number }>(
  [...PARTS.ptrap_washer, ...PARTS.furnace_filter].map((p) => [p.sku, { name: p.name, price: p.price }]),
);

export interface FakeOptions {
  /** Make triage return a hard stop for any symptom. */
  alwaysHardStop?: boolean;
}

export class FakeHearth {
  readonly calls: { name: string; args: Record<string, unknown> }[] = [];
  readonly completed: string[] = [];
  private readonly sessions = new Map<string, { sku: string; total: number; eta: string }>();
  private assetCount = 10;
  private seq = 0;

  constructor(private readonly opts: FakeOptions = {}) {}

  get names(): string[] {
    return this.calls.map((c) => c.name);
  }

  callTool = async (name: string, args: Record<string, unknown>): Promise<ToolCallResult> => {
    this.calls.push({ name, args });
    const spec = toolSpec(name);
    if (!spec) return this.err("not_found", `Unknown tool ${name}`);
    const input = spec.input.safeParse(args);
    if (!input.success) return this.err("invalid_input", input.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const out = this.run(name, input.data as Record<string, unknown>);
    if ("error" in out) return out.error;
    const structured = spec.output.parse(out.value) as Record<string, unknown>;
    const result: ToolCallResult = { content: [{ type: "text", text: out.text }], structuredContent: structured, ms: 5 };
    if (spec.widget) {
      result._meta = {
        ui: UiMeta.parse({ resourceUri: `ui://hearth/${spec.widget}-9f3c1a.html`, pattern: WIDGET_PATTERN[spec.widget], widget: spec.widget, props: structured }),
      };
    }
    return result;
  };

  private err(code: string, message: string): ToolCallResult {
    return { content: [{ type: "text", text: message }], structuredContent: { error: { code, message } }, isError: true, ms: 1 };
  }

  private run(name: string, a: Record<string, unknown>): { value: unknown; text: string } | { error: ToolCallResult } {
    switch (name) {
      case "triage_issue":
        return { value: this.triage(a), text: "Triage complete." };
      case "get_repair_steps": {
        const idx = Number(a.stepIndex ?? 0);
        const s = STEPS[idx];
        if (!s) return { error: this.err("not_found", "No such step") };
        const step: Record<string, unknown> = {
          issueId: String(a.issueId),
          issueTitle: "Leak under the sink P-trap",
          stepIndex: idx,
          stepCount: STEPS.length,
          instruction: s.instruction,
          primaryAction: "isLast" in s ? "done" : "next",
          canSkip: false,
          isLast: "isLast" in s,
        };
        if ("caution" in s) step.caution = s.caution;
        if ("partNeeded" in s) step.partNeeded = s.partNeeded;
        return { value: step, text: `Step ${idx + 1} of ${STEPS.length}: ${s.instruction}.` };
      }
      case "find_exact_part": {
        const role = String(a.partRole) as keyof typeof PARTS;
        const list = PARTS[role];
        if (!list) return { error: this.err("not_found", "No parts for that role") };
        return {
          value: {
            title: role === "furnace_filter" ? "Furnace filters" : "P-trap washers",
            partRole: role,
            items: list.map((p) => ({ ...p, currency: "USD", image: `${MEDIA}/part-slip-washer.svg`, confidence: 0.9, etaDate: "2026-10-27" })),
            selectedIndex: 0,
          },
          text: `Found ${list.length} parts.`,
        };
      }
      case "create_checkout_session": {
        const part = PRICES.get(String(a.sku));
        if (!part) return { error: this.err("not_found", "Unknown SKU") };
        this.seq += 1;
        const sessionId = `cs_fake_${this.seq}`;
        const subtotal = part.price;
        const tax = Math.round(subtotal * 0.0825 * 100) / 100;
        const total = Math.round((subtotal + tax) * 100) / 100;
        this.sessions.set(sessionId, { sku: String(a.sku), total, eta: "2026-10-27" });
        return {
          value: {
            state: "checkout",
            sessionId,
            lineItems: [{ sku: String(a.sku), name: part.name, qty: Number(a.qty), unitPrice: part.price }],
            totals: { subtotal, tax, shipping: 0, total, currency: "USD" },
            etaDate: "2026-10-27",
            paymentDisplay: "Visa ending 4242",
            commitmentText: `You're ordering 1 ${part.name} for $${total.toFixed(2)}, arriving Tuesday, October 27, on your Visa ending 4242.`,
          },
          text: "Checkout session created.",
        };
      }
      case "complete_checkout": {
        const s = this.sessions.get(String(a.sessionId));
        if (!s) return { error: this.err("not_found", "No such session") };
        this.completed.push(String(a.sessionId));
        return {
          value: {
            state: "confirmation",
            orderId: `ord_${this.seq}`,
            orderNumber: `HR-100${this.seq}`,
            summary: `Your order HR-100${this.seq} is placed for $${s.total.toFixed(2)}.`,
            etaDate: s.eta,
            receiptUrl: "http://localhost:4200/receipts/ord_1",
            chargedAmount: s.total,
            supportEmail: "support@hearth.example",
            emailStatus: "written_to_outbox",
            paymentMode: "simulated",
          },
          text: "Order placed.",
        };
      }
      case "prepare_pro_brief":
        return {
          value: {
            briefId: "brief_1",
            headline: "Garbage disposal leaking from the body",
            trade: "plumber",
            asset: { brand: "InSinkErator", model: "Badger 5", ageYears: 9 },
            symptom: String(a.symptom),
            timeline: [{ ts: "2026-10-21T09:00:00Z", text: "Leak reported" }],
            attempted: Array.isArray(a.attempted) ? (a.attempted as string[]) : [],
            accessNotes: "Under the kitchen sink; shut-off valve on the back wall.",
            photos: [`${MEDIA}/disposal-reset.svg`],
            shareUrl: "http://localhost:4200/brief/abc",
            qrPayload: "http://localhost:4200/brief/abc",
            handoffLine: "Want me to find a plumber?",
          },
          text: "Brief ready.",
        };
      case "get_weekend_plan":
        return {
          value: {
            weekendLabel: "Saturday, October 24",
            tasks: [
              { id: "t1", title: "Replace the furnace filter", why: "It is 94 days old.", dueState: "overdue", minutes: 10, assetName: "furnace", action: { type: "reorder", sku: "HR-FLT-16251-M11" } },
              { id: "t2", title: "Check the dishwasher recall", why: "Your Bosch dishwasher matches a sample recall.", dueState: "due", minutes: 15, assetName: "dishwasher" },
              { id: "t3", title: "Clear the gutters", why: "Leaf season.", dueState: "seasonal", minutes: 45, assetName: "gutters" },
            ],
          },
          text: "Weekend plan.",
        };
      case "log_completion":
        return {
          value: {
            eventId: "evt_1",
            summary: "Replaced the P-trap washer under the kitchen sink.",
            nextDue: { taskId: "task_1", dueDate: "2026-10-30", title: "Check that the P-trap is still dry" },
          },
          text: "Logged.",
        };
      case "get_history":
        return {
          value: {
            title: "Disposal history",
            events: [
              { eventId: "e2", ts: "2026-02-03T10:00:00Z", type: "maintenance", summary: "Cleaned the disposal.", assetName: "garbage disposal" },
              { eventId: "e1", ts: "2025-03-14T10:00:00Z", type: "repair", summary: "Reset the garbage disposal after a jam.", assetName: "garbage disposal", cost: 0 },
            ],
          },
          text: "History.",
        };
      case "check_recalls":
        return {
          value: {
            checkedCount: 10,
            datasetLabel: "Demo dataset: a labelled sample, not live CPSC data",
            flagged: [
              {
                assetId: "asset_dishwasher",
                assetName: "dishwasher",
                brand: "Bosch",
                model: "SHEM63W55N",
                recallId: "SAMPLE-001",
                title: "Sample recall: dishwasher heating element may overheat",
                hazard: "Overheating",
                remedy: ["Stop using the heated dry cycle.", "Contact the maker for a free repair."],
                isSample: true,
              },
            ],
          },
          text: "Recalls.",
        };
      case "get_home_profile":
        return { value: this.profile(), text: "Home profile." };
      case "add_asset": {
        this.assetCount += 1;
        const loc = a.location as { room: string; note?: string };
        return { value: this.profile({ assetId: `asset_new_${this.assetCount}`, label: String(a.label), created: true }, loc), text: "Added." };
      }
      default:
        return { error: this.err("not_found", `Unhandled ${name}`) };
    }
  }

  private profile(highlight?: { assetId: string; label: string; created: boolean }, loc?: { room: string; note?: string }) {
    return {
      homeId: "home_1",
      name: "The Okafor House",
      city: "Austin",
      state: "TX",
      yearBuilt: 2004,
      assetCount: this.assetCount,
      inventoryByType: { appliance: 6, shutoff: 2 },
      keyLocations: [
        { assetId: "asset_main", label: "main water shut-off", location: "garage, left of the panel" },
        ...(highlight && loc ? [{ assetId: highlight.assetId, label: highlight.label, location: loc.note ? `${loc.room}, ${loc.note}` : loc.room }] : []),
      ],
      recentEvents: [],
      openIssues: [],
      ...(highlight ? { highlight } : {}),
    };
  }

  private triage(a: Record<string, unknown>): unknown {
    const text = String(a.symptomText).toLowerCase();
    const answers = (a.answers ?? {}) as Record<string, string>;
    const base = { confidence: 0.86, clarifyingQuestions: [], safety: { hardStop: false }, escalate: false };
    if (this.opts.alwaysHardStop || /\bgas\b/.test(text)) {
      return { ...base, issueId: null, confidence: 1, safety: { hardStop: true, message: GAS_MESSAGE, category: "gas" }, trade: "gas_utility" };
    }
    if (text.includes("disposal")) {
      return {
        ...base,
        issueId: "disposal-leak-body",
        issueTitle: "Disposal leaking from the body",
        escalate: true,
        escalateReason: "Internal seal failure on a 9-year-old unit.",
        trade: "plumber",
        suspectedAsset: { assetId: "asset_disposal", label: "garbage disposal" },
      };
    }
    if (text.includes("sink") || text.includes("water under")) {
      const source = answers.source?.toLowerCase();
      if (!source) {
        return {
          ...base,
          issueId: null,
          confidence: 0.4,
          clarifyingQuestions: [{ id: "source", text: "Is it dripping from the pipes, or pooling from the dishwasher side?", options: ["Pipes", "Dishwasher side"] }],
        };
      }
      if (source.includes("pipe")) {
        return {
          ...base,
          issueId: "leak-under-sink-ptrap",
          issueTitle: "Leak under the sink P-trap",
          trade: "plumber",
          suspectedAsset: { assetId: "asset_ptrap_kitchen", label: "kitchen sink P-trap" },
        };
      }
    }
    return { ...base, issueId: null, confidence: 0.1 };
  }
}
