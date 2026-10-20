import {
  FindPartOutput,
  HistoryOutput,
  HomeProfileOutput,
  LogCompletionOutput,
  ProBriefOutput,
  RecallsOutput,
  RepairStepsOutput,
  TriageOutput,
  UiMeta,
  WeekendPlanOutput,
  toolSpec,
  type ToolName,
} from "@hearth/contracts";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Harness, startHarness } from "./fixtures/harness";

let h: Harness;
let client: Client;
const seen: { name: string; result: CallToolResult }[] = [];

beforeAll(async () => {
  h = await startHarness();
  client = await h.connect();
  // Real hosts list tools first. That makes the SDK client validate every structuredContent, errors included.
  await client.listTools();
});
afterAll(async () => {
  await h.close();
});

/** Calls a tool and checks the envelope every result must satisfy. */
async function call(name: ToolName, args: Record<string, unknown> = {}): Promise<CallToolResult> {
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  seen.push({ name, result });
  const first = result.content[0];
  expect(first?.type).toBe("text");
  expect(first && "text" in first ? first.text.length : 0).toBeGreaterThan(0);
  const meta = result._meta as Record<string, unknown>;
  expect(typeof meta["hearth/serverMs"]).toBe("number");
  if (!result.isError) {
    const spec = toolSpec(name);
    expect(spec?.output.safeParse(result.structuredContent).success).toBe(true);
    if (spec?.widget) {
      const ui = UiMeta.parse(meta.ui);
      expect(ui.widget).toBe(spec.widget);
      expect(ui.resourceUri).toMatch(new RegExp(`^ui://hearth/${spec.widget}-`));
      expect(ui.props).toEqual(result.structuredContent);
    } else {
      expect(meta.ui).toBeUndefined();
    }
  }
  return result;
}

const say = (r: CallToolResult): string => {
  const first = r.content[0];
  return first && "text" in first ? first.text : "";
};
const LONG_DASH = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);
const as = <T>(schema: z.ZodType<T>, r: CallToolResult): T => schema.parse(r.structuredContent);

describe("get_home_profile", () => {
  it("summarises the Okafor house with the main shut-off first", async () => {
    const r = await call("get_home_profile");
    const d = as(HomeProfileOutput, r);
    expect(d.assetCount).toBe(12);
    expect(d.name).toBe("The Okafor House");
    expect(d.keyLocations).toHaveLength(6);
    expect(d.keyLocations[0]).toMatchObject({ assetId: "asset_main_shutoff_garage", location: "Garage, left of the panel" });
    expect(d.keyLocations[0]?.photoUrl).toMatch(/\/media\/main-shutoff-garage\.svg$/);
    expect(d.inventoryByType).toMatchObject({ shutoff: 2, panel: 1, hvac: 2 });
    expect(d.recentEvents).toHaveLength(3);
    expect(d.recentEvents[0]?.summary).toContain("P-trap");
    expect(say(r)).toContain("12 things");
    expect(say(r)).toContain("main water shut-off is in the garage");
  });
});

describe("add_asset", () => {
  const base = {
    type: "appliance",
    category: "Water Softener",
    label: "water softener",
    brand: "Kinetico",
    model: "K5",
    installYear: 2022,
    location: { room: "Garage", note: "next to the water heater" },
  };

  it("creates an asset, highlights it and writes an added_asset event", async () => {
    const r = await call("add_asset", { ...base, photoUrl: "https://example.com/label.jpg", idempotencyKey: "add-softener-1" });
    const d = as(HomeProfileOutput, r);
    expect(d.highlight).toEqual({ assetId: "asset_water_softener_garage", label: "water softener", created: true });
    expect(d.assetCount).toBe(13);
    expect(d.recentEvents[0]).toMatchObject({ type: "added_asset" });
    expect(say(r)).toContain("water softener");
    expect(say(r)).toContain("garage");
    const saved = await h.repo.getAsset("home_okafor", "asset_water_softener_garage");
    expect(saved).toMatchObject({ category: "water_softener", brand: "Kinetico", installDate: "2022-01-01" });
    expect(saved?.photos.map((p) => p.url)).toEqual(["https://example.com/label.jpg"]);
  });

  it("replays the same idempotency key without a second write", async () => {
    const events = (await h.repo.listEvents("home_okafor")).length;
    const r = await call("add_asset", { ...base, photoUrl: "https://example.com/label.jpg", idempotencyKey: "add-softener-1" });
    expect(as(HomeProfileOutput, r).highlight?.created).toBe(true);
    expect((await h.repo.listEvents("home_okafor")).length).toBe(events);
  });

  it("updates in place when category and room match, with a new key", async () => {
    const r = await call("add_asset", { ...base, label: "water softener (salt tank)", serial: "SN-123", idempotencyKey: "add-softener-2" });
    const d = as(HomeProfileOutput, r);
    expect(d.highlight).toEqual({ assetId: "asset_water_softener_garage", label: "water softener (salt tank)", created: false });
    expect(d.assetCount).toBe(13);
    expect(await h.repo.getAsset("home_okafor", "asset_water_softener_garage")).toMatchObject({ serial: "SN-123", brand: "Kinetico" });
    expect(say(r)).toContain("updated");
  });

  it("rejects an unknown assetId and bad arguments with voice-safe errors", async () => {
    const missing = await call("add_asset", { ...base, assetId: "asset_nope", idempotencyKey: "add-softener-3" });
    expect(missing.isError).toBe(true);
    expect(missing.structuredContent).toMatchObject({ error: { code: "not_found" } });

    const bad = await call("add_asset", { type: "gadget", label: "x" });
    expect(bad.isError).toBe(true);
    expect(bad.structuredContent).toMatchObject({ error: { code: "invalid_input" } });
    expect(say(bad)).not.toMatch(/zod|schema|undefined|\.type/i);
    expect((bad._meta as Record<string, unknown>)["hearth/issues"]).toBeInstanceOf(Array);
  });
});

describe("triage_issue, get_repair_steps, find_exact_part", () => {
  it("asks the clarifying question, then resolves to the P-trap playbook", async () => {
    const first = await call("triage_issue", { symptomText: "there's water under the kitchen sink" });
    expect(as(TriageOutput, first).clarifyingQuestions).toHaveLength(1);
    expect(say(first)).toBe("Is it dripping from the pipes, or pooling from the dishwasher side?");

    const second = await call("triage_issue", { symptomText: "there's water under the kitchen sink", answers: { source: "pipes" } });
    expect(as(TriageOutput, second)).toMatchObject({ issueId: "leak-under-sink-ptrap", escalate: false, safety: { hardStop: false } });
    expect(say(second)).toContain("kitchen sink P-trap");
  });

  it("reads the hard-stop message verbatim and escalates a failed disposal", async () => {
    const gas = await call("triage_issue", { symptomText: "I smell gas near the furnace" });
    const stop = as(TriageOutput, gas);
    expect(stop.safety.hardStop).toBe(true);
    expect(say(gas)).toBe(stop.safety.message);

    const disposal = await call("triage_issue", { symptomText: "water is leaking from the disposal unit itself" });
    expect(as(TriageOutput, disposal)).toMatchObject({ escalate: true, trade: "plumber" });
    expect(say(disposal)).toContain("pro");
  });

  it("serves personalised steps, then stops at the end", async () => {
    const step0 = await call("get_repair_steps", { issueId: "leak-under-sink-ptrap" });
    const s0 = as(RepairStepsOutput, step0);
    expect(s0).toMatchObject({ stepIndex: 0, stepCount: 3, primaryAction: "next", isLast: false });
    expect(s0.image).toMatchObject({ isUsersPhoto: true });
    expect(s0.locationChip).toContain("YOUR VALVE");
    expect(say(step0)).toContain("Step 1 of 3");

    const step2 = await call("get_repair_steps", { issueId: "leak-under-sink-ptrap", stepIndex: 2 });
    expect(as(RepairStepsOutput, step2)).toMatchObject({ isLast: true, primaryAction: "done", partNeeded: { partRole: "ptrap_washer", assetId: "asset_ptrap_kitchen" } });

    const past = await call("get_repair_steps", { issueId: "leak-under-sink-ptrap", stepIndex: 9 });
    expect(past.structuredContent).toMatchObject({ error: { code: "invalid_input" } });
    const unknown = await call("get_repair_steps", { issueId: "no-such-playbook" });
    expect(unknown.structuredContent).toMatchObject({ error: { code: "not_found" } });
  });

  it("finds parts by asset, and by issue when no asset is given", async () => {
    const byAsset = await call("find_exact_part", { assetId: "asset_ptrap_kitchen", partRole: "ptrap_washer" });
    const parts = as(FindPartOutput, byAsset);
    expect(parts.items.length).toBeGreaterThanOrEqual(1);
    expect(parts.items[0]).toMatchObject({ badge: "EXACT FIT", price: 4.29 });
    expect(parts.assetLabel).toBe("kitchen sink P-trap");
    expect(say(byAsset)).toContain("$4.29");
    expect(say(byAsset)).toContain("the first one");
    expect(say(byAsset)).not.toContain("HR-");

    const byIssue = await call("find_exact_part", { issueId: "leak-under-sink-ptrap", partRole: "ptrap_washer" });
    expect(as(FindPartOutput, byIssue).assetLabel).toBe("kitchen sink P-trap");
  });

  it("fails an unknown part role in a voice-safe way", async () => {
    const r = await call("find_exact_part", { partRole: "flux_capacitor" });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ error: { code: "not_found", message: "I couldn't find that part. Want me to show the closest matches?" } });
    const missingAsset = await call("find_exact_part", { assetId: "asset_nope", partRole: "ptrap_washer" });
    expect(missingAsset.structuredContent).toMatchObject({ error: { code: "not_found" } });
  });
});

describe("get_weekend_plan", () => {
  it("ranks the furnace filter first with its size, age and a reorder action", async () => {
    const r = await call("get_weekend_plan");
    const d = as(WeekendPlanOutput, r);
    expect(d.weekendLabel).toBe("Oct 24-25");
    expect(d.tasks.length).toBeLessThanOrEqual(6);
    const [first] = d.tasks;
    expect(first?.title).toContain("16x25x1");
    expect(first?.why).toContain("94 days");
    expect(first).toMatchObject({ dueState: "overdue", assetName: "furnace", action: { type: "reorder", sku: "HR-FLT-16251" } });

    const titles = d.tasks.map((t) => t.title);
    expect(titles.some((t) => /recall/i.test(t))).toBe(true);
    expect(titles.some((t) => /P-trap is still dry/i.test(t))).toBe(true);
    expect(titles.some((t) => /gutters/i.test(t))).toBe(true);
    expect(d.tasks.find((t) => /gutters/i.test(t.title))?.dueState).toBe("seasonal");
    expect(new Set(d.tasks.map((t) => t.id)).size).toBe(d.tasks.length);
    expect(say(r)).toContain("Oct 24-25");
    expect(say(r)).toContain("16x25x1");
  });

  it("follows the date argument and names a weekend across months", async () => {
    const r = await call("get_weekend_plan", { date: "2026-10-28" });
    expect(as(WeekendPlanOutput, r).weekendLabel).toBe("Oct 31 to Nov 1");
    const sunday = await call("get_weekend_plan", { date: "2026-10-25" });
    expect(as(WeekendPlanOutput, sunday).weekendLabel).toBe("Oct 24-25");
  });
});

describe("log_completion", () => {
  it("resets a consumable, closes its reminder and schedules the next one", async () => {
    const r = await call("log_completion", {
      kind: "maintenance",
      summary: "Replaced the furnace filter with a new 16x25x1",
      assetId: "asset_furnace_hall",
      partSku: "HR-FLT-16251",
      cost: 14.99,
      idempotencyKey: "log-filter-1",
    });
    expect(as(LogCompletionOutput, r).nextDue).toMatchObject({ dueDate: "2027-01-19", title: "Replace your furnace filter 16x25x1 MERV 11" });
    expect(say(r)).toContain("January 19");

    const furnace = await h.repo.getAsset("home_okafor", "asset_furnace_hall");
    expect(furnace?.consumables[0]?.lastReplaced).toBe("2026-10-21");
    const old = (await h.repo.listTasks("home_okafor")).find((t) => t.taskId === "task_filter_furnace");
    expect(old?.done).toBe(true);

    const events = await h.repo.listEvents("home_okafor", { assetId: "asset_furnace_hall", limit: 1 });
    expect(events[0]).toMatchObject({ type: "maintenance", cost: 14.99 });

    const plan = as(WeekendPlanOutput, await call("get_weekend_plan"));
    expect(plan.tasks.some((t) => /furnace filter/i.test(t.title))).toBe(false);
  });

  it("replays an idempotent write without logging twice", async () => {
    const before = (await h.repo.listEvents("home_okafor")).length;
    const r = await call("log_completion", {
      kind: "maintenance",
      summary: "Replaced the furnace filter with a new 16x25x1",
      assetId: "asset_furnace_hall",
      partSku: "HR-FLT-16251",
      cost: 14.99,
      idempotencyKey: "log-filter-1",
    });
    expect(as(LogCompletionOutput, r).nextDue?.dueDate).toBe("2027-01-19");
    expect((await h.repo.listEvents("home_okafor")).length).toBe(before);
  });

  it("schedules the playbook follow-up for a repair, honours nextDueDays, and allows no next date", async () => {
    const r = await call("log_completion", { kind: "repair", summary: "Fixed the sink leak", issueId: "leak-under-sink-ptrap", idempotencyKey: "log-ptrap-1" });
    expect(as(LogCompletionOutput, r).nextDue).toMatchObject({ dueDate: "2026-10-28", title: "Check the P-trap is still dry" });
    const event = (await h.repo.listEvents("home_okafor", { assetId: "asset_ptrap_kitchen", limit: 1 }))[0];
    expect(event).toMatchObject({ type: "repair", summary: "Fixed the sink leak" });

    const custom = await call("log_completion", { kind: "maintenance", summary: "Flushed the water heater", nextDueDays: 365, idempotencyKey: "log-flush-1" });
    expect(as(LogCompletionOutput, custom).nextDue).toMatchObject({ dueDate: "2027-10-21" });

    const plain = await call("log_completion", { kind: "maintenance", summary: "Wiped down the fridge", idempotencyKey: "log-wipe-001" });
    expect(as(LogCompletionOutput, plain).nextDue).toBeUndefined();
  });
});

describe("get_history", () => {
  it("finds the disposal by keyword through the asset label", async () => {
    const r = await call("get_history", { query: "disposal" });
    const d = as(HistoryOutput, r);
    expect(d.title).toBe("History: disposal");
    expect(d.events).toHaveLength(1);
    expect(d.events[0]).toMatchObject({ eventId: "evt_disposal_reset", type: "repair", assetName: "garbage disposal" });
    expect(say(r)).toContain("March 2");
  });

  it("filters by asset and by type and honours the limit", async () => {
    const byAsset = as(HistoryOutput, await call("get_history", { assetId: "asset_furnace_hall" }));
    expect(byAsset.title).toBe("Furnace history");
    expect(byAsset.events.every((e) => e.assetName === "furnace")).toBe(true);

    const repairs = as(HistoryOutput, await call("get_history", { type: "repair", limit: 2 }));
    expect(repairs.events).toHaveLength(2);
    expect(repairs.events.every((e) => e.type === "repair")).toBe(true);

    const none = await call("get_history", { query: "boat engine" });
    expect(as(HistoryOutput, none).events).toEqual([]);
    expect(say(none)).toContain("don't have anything");
  });
});

describe("check_recalls", () => {
  it("flags the dishwasher and discloses that the dataset is a sample", async () => {
    const r = await call("check_recalls");
    const d = as(RecallsOutput, r);
    expect(d.checkedCount).toBe(13);
    expect(d.datasetLabel).toMatch(/sample/i);
    expect(d.flagged).toHaveLength(1);
    expect(d.flagged[0]).toMatchObject({ assetId: "asset_dishwasher_kitchen", brand: "Bosch", model: "SHEM63W55N", recallId: "RC-SAMPLE-DW-001", isSample: true });
    expect(say(r)).toContain("sample");
    expect(say(r)).toContain("Stop using the heated dry cycle");
  });
});

describe("prepare_pro_brief", () => {
  const args = {
    issueId: "disposal-leak-body",
    symptom: "Water is leaking from the body of the garbage disposal",
    attempted: ["Tightened the drain flange", "Ran the disposal with cold water"],
    idempotencyKey: "brief-disposal-1",
  };

  it("builds a shareable brief from the home's own records", async () => {
    const r = await call("prepare_pro_brief", args);
    const d = as(ProBriefOutput, r);
    expect(d).toMatchObject({ trade: "plumber", asset: { brand: "InSinkErator", model: "Badger 5", ageYears: 9 }, handoffLine: "Want me to find a plumber?" });
    expect(d.headline).toBe("Garbage disposal: Water is leaking from the body of the garbage disposal");
    expect(d.attempted).toEqual(args.attempted);
    expect(d.timeline.at(-1)).toEqual({ ts: "2026-10-21", text: `Reported: ${args.symptom}` });
    expect(d.timeline[0]?.text).toContain("Reset the garbage disposal");
    expect(d.accessNotes).toContain("kitchen sink shut-offs");
    expect(d.photos.length).toBeGreaterThanOrEqual(1);
    expect(d.shareUrl).toMatch(new RegExp(`^${h.base}/briefs/[A-Za-z0-9_-]{20,}$`));
    expect(d.qrPayload).toBe(d.shareUrl);
    expect(say(r)).toBe("I've put together a job brief for your garbage disposal. Want me to find a plumber?");

    const escalation = (await h.repo.listEvents("home_okafor", { type: "escalation" }))[0];
    expect(escalation).toMatchObject({ assetId: "asset_disposal_kitchen" });
    const issues = await h.repo.listIssues("home_okafor");
    expect(issues.find((i) => i.playbookId === "disposal-leak-body")).toMatchObject({ status: "escalated" });
  });

  it("renders the public brief page on kraft paper, and 404s a wrong token", async () => {
    const r = await call("prepare_pro_brief", args);
    const page = await fetch(as(ProBriefOutput, r).shareUrl);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    const html = await page.text();
    expect(html).toContain("JOB BRIEF");
    expect(html).toContain("Badger 5");
    expect(html).toContain("Tightened the drain flange");
    expect(html).toContain("fonts.googleapis.com");
    expect(html).toContain("noindex");
    expect((await fetch(`${h.base}/briefs/not-a-real-token`)).status).toBe(404);
  });

  it("is idempotent", async () => {
    const first = as(ProBriefOutput, await call("prepare_pro_brief", args));
    const again = as(ProBriefOutput, await call("prepare_pro_brief", args));
    expect(again.briefId).toBe(first.briefId);
    expect(h.repo.briefs.size).toBe(1);
  });

  it("routes a hard stop symptom to the right trade even with no asset", async () => {
    const r = await call("prepare_pro_brief", { symptom: "I can smell gas in the kitchen", idempotencyKey: "brief-gas-0001" });
    expect(as(ProBriefOutput, r)).toMatchObject({ trade: "gas_utility", asset: { brand: "Unknown" } });
    expect(say(r)).toContain("gas company");
  });
});

describe("voice safety and latency", () => {
  it("never puts a dash, SKU or stack trace into spoken text", () => {
    expect(seen.length).toBeGreaterThan(20);
    for (const { name, result } of seen) {
      const text = say(result);
      expect(text, name).not.toMatch(LONG_DASH);
      expect(text, name).not.toMatch(/\bHR-[A-Z0-9-]+/);
      expect(text, name).not.toMatch(/\bat .*\(.*:\d+:\d+\)|Error:|undefined|\[object/);
    }
  });

  it("answers every tool inside the 500 ms budget", () => {
    for (const { name, result } of seen) {
      expect((result._meta as Record<string, number>)["hearth/serverMs"], name).toBeLessThan(500);
    }
  });
});
