import type { Asset, Consumable, HomeEvent, Task, WeekendPlanOutput, WeekendTask } from "@hearth/contracts";
import type { Core, Ctx } from "./core";
import { todayFor } from "./core";
import { addDays, comingWeekend, diffDays, monthNumber, shortMonthDay, weekendLabel } from "./dates";
import { findSize, lcFirst, normalizeSizes, plain } from "./format";
import { matchingRecalls } from "./recalls";

type DueState = WeekendTask["dueState"];

interface SeasonalJob {
  key: string;
  title: string;
  why: string;
  minutes: number;
  /** Used to name the home's own asset when it has one, else `fallbackAsset`. */
  assetPattern: RegExp;
  fallbackAsset: string;
}

/** Seasonal jobs for climate zone 2A (hot, humid), one or two per month. */
const SEASONAL_2A: Record<number, SeasonalJob[]> = {
  1: [{ key: "water-heater-flush", title: "Flush the water heater tank", why: "Sediment settles over the year and a flush keeps the tank efficient.", minutes: 30, assetPattern: /water heater/i, fallbackAsset: "Water heater" }],
  2: [{ key: "gfci", title: "Test the GFCI outlets in the kitchen and baths", why: "Press test and reset on each one. It takes a minute and proves they still trip.", minutes: 10, assetPattern: /panel/i, fallbackAsset: "Electrical" }],
  3: [{ key: "condenser", title: "Clear leaves and debris from the AC condenser", why: "Cooling season is close and a clear unit runs cooler.", minutes: 20, assetPattern: /condenser|air condition/i, fallbackAsset: "AC condenser" }],
  4: [{ key: "weatherstrip", title: "Check door and window weatherstripping", why: "Gaps let humid air in and make the AC work harder.", minutes: 20, assetPattern: /^$/, fallbackAsset: "Whole house" }],
  5: [{ key: "condensate", title: "Flush the AC condensate drain with vinegar", why: "A clear drain line prevents water stains and overflow in peak cooling season.", minutes: 15, assetPattern: /air condition|condenser|air handler/i, fallbackAsset: "Air conditioner" }],
  6: [{ key: "washer-hoses", title: "Check the washing machine hoses for bulges", why: "Old supply hoses fail without warning. A quick look is enough.", minutes: 10, assetPattern: /washing machine|washer/i, fallbackAsset: "Washing machine" }],
  7: [{ key: "dryer-vent", title: "Clean the dryer vent", why: "Lint buildup cuts airflow and is a fire risk.", minutes: 30, assetPattern: /dryer/i, fallbackAsset: "Dryer vent" }],
  8: [{ key: "caulk", title: "Re-caulk gaps around tubs and sinks", why: "Humid summers loosen old caulk and water gets behind it.", minutes: 45, assetPattern: /^$/, fallbackAsset: "Bathrooms" }],
  9: [{ key: "furnace-prep", title: "Vacuum the furnace area and return vents", why: "Heating season is near and clean returns move air better.", minutes: 20, assetPattern: /furnace/i, fallbackAsset: "Furnace" }],
  10: [{ key: "gutters", title: "Clean the gutters and downspouts", why: "Fall leaves clog them, and the next heavy rain finds the weak spot.", minutes: 60, assetPattern: /^$/, fallbackAsset: "Gutters" }],
  11: [{ key: "smoke", title: "Test every smoke detector", why: "A monthly test takes a minute and shows whether the batteries still work.", minutes: 10, assetPattern: /smoke/i, fallbackAsset: "Smoke detectors" }],
  12: [{ key: "water-heater-look", title: "Look over the water heater for drips and corrosion", why: "Catching a slow leak early is much cheaper than a flooded garage.", minutes: 10, assetPattern: /water heater/i, fallbackAsset: "Water heater" }],
};

const SEASONAL_BY_ZONE: Record<string, Record<number, SeasonalJob[]>> = { "2A": SEASONAL_2A };

function consumableMinutes(c: Consumable): number {
  const hay = `${c.label} ${c.sku}`.toLowerCase();
  if (/filter/.test(hay)) return 5;
  if (/battery|batteries/.test(hay)) return 15;
  return 10;
}

function stateFor(due: string, today: string, sunday: string): DueState {
  if (due < today) return "overdue";
  if (due <= sunday) return "due";
  return "soon";
}

interface Row {
  task: WeekendTask;
  /** Lower sorts first inside a group. */
  sort: number;
  /** Asset this row already covers, so a scheduled task for it is not listed twice. */
  assetId?: string;
}

function consumableRows(core: Core, assets: Asset[], today: string, sunday: string): { urgent: Row[]; soon: Row[] } {
  const urgent: Row[] = [];
  const soon: Row[] = [];
  const horizon = addDays(sunday, 21);
  for (const asset of assets) {
    for (const c of asset.consumables) {
      if (!c.lastReplaced) continue;
      const due = addDays(c.lastReplaced, c.intervalDays);
      if (due > horizon) continue;
      const since = diffDays(c.lastReplaced, today);
      const state = stateFor(due, today, sunday);

      const sku = core.parts.getSku(c.sku);
      const size = findSize(c.label) ?? findSize(Object.values(asset.attributes).join(" ")) ?? findSize(sku?.name ?? "");
      const label = normalizeSizes(c.label);
      const named = size && !findSize(c.label) ? `${label} ${size}` : label;

      const row: WeekendTask = {
        id: `consumable:${asset.assetId}:${c.sku}`,
        title: plain(`Replace your ${lcFirst(named)}`),
        why:
          state === "soon"
            ? `Due in ${diffDays(today, due)} days. Last changed ${since} days ago.`
            : `Last changed ${since} days ago. It's due every ${c.intervalDays} days.`,
        dueState: state,
        minutes: consumableMinutes(c),
        assetName: asset.label,
        ...(sku ? { action: { type: "reorder" as const, sku: sku.sku } } : {}),
      };
      // Whole-home systems first (a furnace filter touches every room), then the most overdue.
      const sort = (asset.type === "hvac" ? 0 : 1000) - diffDays(due, today);
      (state === "soon" ? soon : urgent).push({ task: row, sort, assetId: asset.assetId });
    }
  }
  return { urgent: urgent.sort((a, b) => a.sort - b.sort), soon: soon.sort((a, b) => a.sort - b.sort) };
}

function recallRows(core: Core, assets: Asset[]): Row[] {
  const recalls = core.parts.listRecalls();
  const rows: Row[] = [];
  for (const asset of assets) {
    for (const recall of matchingRecalls(asset, recalls)) {
      rows.push({
        sort: 0,
        assetId: asset.assetId,
        task: {
          id: `recall:${asset.assetId}:${recall.recallId}`,
          title: plain(`Check the recall notice for your ${asset.label}`),
          why: plain(`Sample recall: ${recall.title}.`),
          dueState: "due",
          minutes: 15,
          assetName: asset.label,
        },
      });
    }
  }
  return rows;
}

const RECENT_REPAIR_DAYS = 14;

/** "Replaced the washer. It stayed dry." becomes "Replaced the washer, 6 days ago. Make sure the fix is holding." */
function fixHolding(event: HomeEvent, ago: number): string {
  const first = (event.summary.split(/(?<=[.!?])\s/)[0] ?? event.summary).replace(/[.!?\s]+$/, "");
  const when = ago <= 0 ? "today" : ago === 1 ? "yesterday" : `${ago} days ago`;
  return plain(`${first}, ${when}. Make sure the fix is holding.`);
}

function recentRepair(events: HomeEvent[], assetId: string | undefined, today: string, withinDays: number): HomeEvent | undefined {
  if (!assetId) return undefined;
  return events.find((e) => e.type === "repair" && e.assetId === assetId && diffDays(e.ts.slice(0, 10), today) <= withinDays);
}

function followUpRows(assets: Asset[], tasks: Task[], events: HomeEvent[], today: string, sunday: string): Row[] {
  const byId = new Map(assets.map((a) => [a.assetId, a]));
  const rows: Row[] = [];
  const covered = new Set<string>();

  for (const t of tasks) {
    if (t.kind !== "follow_up") continue;
    if (t.assetId) covered.add(t.assetId);
    if (t.done || t.dueDate > addDays(sunday, 7)) continue;
    const asset = t.assetId ? byId.get(t.assetId) : undefined;
    const repair = recentRepair(events, t.assetId, today, 30);
    const ago = repair ? diffDays(repair.ts.slice(0, 10), today) : undefined;
    rows.push({
      sort: diffDays(today, t.dueDate),
      task: {
        id: t.taskId,
        title: plain(t.title),
        why: repair && ago !== undefined ? fixHolding(repair, ago) : "Follow-up from a recent repair.",
        dueState: stateFor(t.dueDate, today, sunday),
        minutes: 10,
        assetName: asset?.label ?? "Whole house",
      },
    });
  }

  // A repair with no scheduled follow-up still deserves a look while it is fresh.
  for (const e of events) {
    if (e.type !== "repair" || !e.assetId || covered.has(e.assetId)) continue;
    const ago = diffDays(e.ts.slice(0, 10), today);
    if (ago > RECENT_REPAIR_DAYS) continue;
    const asset = byId.get(e.assetId);
    if (!asset) continue;
    covered.add(e.assetId);
    rows.push({
      sort: 100,
      task: {
        id: `followup:${e.eventId}`,
        title: plain(`Check your ${asset.label}`),
        why: fixHolding(e, ago),
        dueState: "soon",
        minutes: 10,
        assetName: asset.label,
      },
    });
  }
  return rows.sort((a, b) => a.sort - b.sort);
}

const mentions = (title: string, job: SeasonalJob): boolean => job.key.split("-").every((word) => title.toLowerCase().includes(word));

function seasonalRows(assets: Asset[], tasks: Task[], zone: string, today: string, sunday: string): Row[] {
  const jobs = SEASONAL_BY_ZONE[zone.toUpperCase()]?.[monthNumber(today)] ?? [];
  const scheduled = tasks.filter((t) => t.kind === "seasonal" && !t.done && t.dueDate <= addDays(sunday, 14));
  const ownAsset = (job: SeasonalJob): Asset | undefined => (job.assetPattern.source === "^$" ? undefined : assets.find((a) => job.assetPattern.test(`${a.label} ${a.category}`)));

  // A scheduled task wins over the built-in job it duplicates, and borrows its explanation.
  const rows: Row[] = scheduled.map((t) => {
    const job = jobs.find((j) => mentions(t.title, j));
    const asset = (t.assetId ? assets.find((a) => a.assetId === t.assetId) : undefined) ?? (job ? ownAsset(job) : undefined);
    return {
      sort: 0,
      task: {
        id: t.taskId,
        title: plain(t.title),
        why: job ? job.why : `Scheduled for ${shortMonthDay(t.dueDate)}.`,
        dueState: "seasonal" as const,
        minutes: job?.minutes ?? 30,
        assetName: asset?.label ?? job?.fallbackAsset ?? "Whole house",
      },
    };
  });
  for (const job of jobs) {
    if (scheduled.some((t) => mentions(t.title, job))) continue;
    rows.push({
      sort: 1,
      task: { id: `seasonal:${monthNumber(today)}:${job.key}`, title: job.title, why: job.why, dueState: "seasonal", minutes: job.minutes, assetName: ownAsset(job)?.label ?? job.fallbackAsset },
    });
  }
  return rows;
}

function scheduledRows(core: Core, assets: Asset[], tasks: Task[], covered: Set<string>, today: string, sunday: string): Row[] {
  const rows: Row[] = [];
  for (const t of tasks) {
    if (t.done || t.kind === "follow_up" || t.kind === "seasonal") continue;
    if (t.dueDate > addDays(sunday, 14)) continue;
    if ((t.kind === "consumable" || t.kind === "recall") && t.assetId && covered.has(t.assetId)) continue;
    const asset = t.assetId ? assets.find((a) => a.assetId === t.assetId) : undefined;
    const sku = t.reorderSku ? core.parts.getSku(t.reorderSku) : undefined;
    rows.push({
      sort: diffDays(today, t.dueDate),
      task: {
        id: t.taskId,
        title: plain(t.title),
        why: t.dueDate < today ? `Was due ${shortMonthDay(t.dueDate)}.` : `Scheduled for ${shortMonthDay(t.dueDate)}.`,
        dueState: stateFor(t.dueDate, today, sunday),
        minutes: t.kind === "inspection" ? 15 : 10,
        assetName: asset?.label ?? "Whole house",
        ...(sku ? { action: { type: "reorder" as const, sku: sku.sku } } : {}),
      },
    });
  }
  return rows.sort((a, b) => a.sort - b.sort);
}

const MAX_ROWS = 6;

export async function getWeekendPlan(core: Core, ctx: Ctx, input: { date?: string | undefined }): Promise<{ output: WeekendPlanOutput; text: string }> {
  const { home } = ctx;
  const today = input.date ?? todayFor(core, home);
  const { saturday, sunday } = comingWeekend(today);
  const [assets, tasks, events] = await Promise.all([
    core.repo.listAssets(home.homeId),
    core.repo.listTasks(home.homeId),
    core.repo.listEvents(home.homeId, { type: "repair", limit: 30 }),
  ]);

  const consumables = consumableRows(core, assets, today, sunday);
  const recalls = recallRows(core, assets);
  const followUps = followUpRows(assets, tasks, events, today, sunday);
  const seasonal = seasonalRows(assets, tasks, home.climateZone, today, sunday);

  const covered = new Set<string>();
  for (const row of [...consumables.urgent, ...consumables.soon, ...recalls]) if (row.assetId) covered.add(row.assetId);
  const scheduled = scheduledRows(core, assets, tasks, covered, today, sunday);

  const ordered = [...consumables.urgent, ...recalls, ...followUps, ...seasonal.slice(0, 2), ...scheduled, ...consumables.soon, ...seasonal.slice(2)].map((r) => r.task);
  const unique = ordered.filter((t, i) => ordered.findIndex((o) => o.id === t.id) === i);

  let chosen = unique.slice(0, MAX_ROWS);
  const firstSeasonal = unique.find((t) => t.dueState === "seasonal");
  if (firstSeasonal && !chosen.includes(firstSeasonal)) chosen = [...chosen.slice(0, MAX_ROWS - 1), firstSeasonal];

  const output: WeekendPlanOutput = { weekendLabel: weekendLabel(saturday, sunday), tasks: chosen };
  return { output, text: planSpeech(output) };
}

function planSpeech(plan: WeekendPlanOutput): string {
  const [first, second] = plan.tasks;
  if (!first) return `Nothing is due for ${plan.weekendLabel}. Your home is in good shape.`;
  const say = (n: string, t: WeekendTask): string => `${n}, ${lcFirst(t.title)}. ${t.why}`;
  const parts = [`Here's your plan for ${plan.weekendLabel}.`, say("First", first)];
  if (second) parts.push(say("Second", second));
  if (plan.tasks.length > 2) parts.push(`There are ${plan.tasks.length - 2} more on your screen.`);
  return plain(parts.join(" "));
}
