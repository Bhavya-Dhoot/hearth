import {
  LogCompletionOutput as LogCompletionOutputSchema,
  type Asset,
  type HistoryInput,
  type HistoryOutput,
  type HomeEvent,
  type LogCompletionInput,
  type LogCompletionOutput,
  type Task,
} from "@hearth/contracts";
import { fail } from "../errors";
import { type Core, type Ctx, assetByCategory, newId, once, todayFor } from "./core";
import { addDays, isoDateIn, longMonthDay } from "./dates";
import { capitalize, lcFirst, normalizeSizes, plain } from "./format";

/* ------------------------------------------------------------------ log_completion */

export async function logCompletion(core: Core, ctx: Ctx, input: LogCompletionInput): Promise<{ output: LogCompletionOutput; text: string }> {
  const output = await once(core, ctx.userId, "log_completion", input.idempotencyKey, LogCompletionOutputSchema, async () => {
    const { home } = ctx;
    const [assets, tasks] = await Promise.all([core.repo.listAssets(home.homeId), core.repo.listTasks(home.homeId)]);
    const today = todayFor(core, home);
    const at = core.now().toISOString();

    const playbook = input.issueId ? core.playbooks.getPlaybook(input.issueId) : undefined;
    let asset: Asset | undefined;
    if (input.assetId) {
      asset = assets.find((a) => a.assetId === input.assetId);
      if (!asset) throw fail("not_found", "I couldn't find that item in your home, so I haven't logged it yet.");
    } else {
      asset = assetByCategory(assets, playbook?.assetCategory);
    }

    // A part that is a consumable on some asset resets that asset's clock.
    const partOwner = input.partSku ? (asset?.consumables.some((c) => c.sku === input.partSku) ? asset : assets.find((a) => a.consumables.some((c) => c.sku === input.partSku))) : undefined;
    const consumable = partOwner?.consumables.find((c) => c.sku === input.partSku);

    const subject = asset ?? partOwner;
    const event: HomeEvent = {
      homeId: home.homeId,
      eventId: newId("evt"),
      ts: at,
      type: input.kind,
      ...(subject ? { assetId: subject.assetId } : {}),
      summary: plain(input.summary.trim()),
      ...(input.cost !== undefined ? { cost: input.cost } : {}),
      photos: [],
    };
    await core.repo.putEvent(event);

    let next: Task | undefined;
    if (partOwner && consumable) {
      await core.repo.putAsset({
        ...partOwner,
        consumables: partOwner.consumables.map((c) => (c.sku === consumable.sku ? { ...c, lastReplaced: today } : c)),
        updatedAt: at,
      });
      // Close the reminders this job satisfies before scheduling the next one.
      for (const t of tasks) {
        if (!t.done && t.kind === "consumable" && t.assetId === partOwner.assetId && (t.reorderSku === undefined || t.reorderSku === consumable.sku)) {
          await core.repo.putTask({ ...t, done: true });
        }
      }
      const dueDate = addDays(today, input.nextDueDays ?? consumable.intervalDays);
      next = {
        homeId: home.homeId,
        taskId: newId("task"),
        dueDate,
        assetId: partOwner.assetId,
        kind: "consumable",
        title: plain(`Replace your ${lcFirst(normalizeSizes(consumable.label))}`),
        priority: 3,
        reorderSku: consumable.sku,
        done: false,
      };
    } else if (input.kind === "repair" && (playbook?.followUpDays !== undefined || input.nextDueDays !== undefined)) {
      const days = input.nextDueDays ?? playbook?.followUpDays ?? 7;
      next = {
        homeId: home.homeId,
        taskId: newId("task"),
        dueDate: addDays(today, days),
        ...(asset ? { assetId: asset.assetId } : {}),
        kind: "follow_up",
        title: plain(playbook?.followUpTitle ?? `Check your ${asset?.label ?? "repair"} is holding`),
        priority: 2,
        done: false,
      };
    } else if (input.nextDueDays !== undefined) {
      next = {
        homeId: home.homeId,
        taskId: newId("task"),
        dueDate: addDays(today, input.nextDueDays),
        ...(asset ? { assetId: asset.assetId } : {}),
        kind: "inspection",
        title: plain(`Repeat: ${input.summary.trim()}`),
        priority: 3,
        done: false,
      };
    }
    if (next) await core.repo.putTask(next);

    // The repair is done: close any escalated or open issue for the same playbook.
    if (input.kind === "repair" && input.issueId) {
      for (const issue of await core.repo.listIssues(home.homeId)) {
        if (issue.status !== "resolved" && issue.playbookId === input.issueId) await core.repo.putIssue({ ...issue, status: "resolved" });
      }
    }

    return {
      eventId: event.eventId,
      summary: event.summary,
      ...(next ? { nextDue: { taskId: next.taskId, dueDate: next.dueDate, title: next.title } } : {}),
    };
  });

  const when = output.nextDue ? ` I've set a reminder for ${longMonthDay(output.nextDue.dueDate)}: ${lcFirst(output.nextDue.title)}.` : "";
  return { output, text: plain(`Logged. ${output.summary.replace(/[.\s]+$/, "")}.${when}`) };
}

/* ------------------------------------------------------------------ get_history */

function title(input: HistoryInput, asset: Asset | undefined): string {
  if (asset) return `${capitalize(asset.label)} history`;
  if (input.query?.trim()) return `History: ${input.query.trim()}`;
  if (input.type) return `${capitalize(input.type.replace("_", " "))} history`;
  return "Home timeline";
}

export async function getHistory(core: Core, ctx: Ctx, input: HistoryInput): Promise<{ output: HistoryOutput; text: string }> {
  const { home } = ctx;
  const assets = await core.repo.listAssets(home.homeId);
  const byId = new Map(assets.map((a) => [a.assetId, a]));

  let focus: Asset | undefined;
  if (input.assetId) {
    focus = byId.get(input.assetId);
    if (!focus) throw fail("not_found", "I couldn't find that item in your home.");
  }

  const query = input.query?.trim().toLowerCase();
  const tokens = query ? query.split(/\s+/).filter(Boolean) : [];
  // Filtering by keyword happens after the fetch, so do not cap the fetch in that case.
  const events = await core.repo.listEvents(home.homeId, {
    ...(input.assetId ? { assetId: input.assetId } : {}),
    ...(input.type ? { type: input.type } : {}),
    ...(tokens.length === 0 ? { limit: input.limit } : {}),
  });

  const matches = (e: HomeEvent): boolean => {
    if (tokens.length === 0) return true;
    const asset = e.assetId ? byId.get(e.assetId) : undefined;
    const hay = [e.summary, asset?.label, asset?.category, asset?.brand].filter(Boolean).join(" ").toLowerCase().replace(/_/g, " ");
    return tokens.every((t) => hay.includes(t));
  };

  const picked = events.filter(matches).slice(0, input.limit);
  const output: HistoryOutput = {
    title: plain(title(input, focus)),
    events: picked.map((e) => {
      const asset = e.assetId ? byId.get(e.assetId) : undefined;
      return {
        eventId: e.eventId,
        ts: e.ts,
        type: e.type,
        summary: plain(e.summary),
        ...(asset ? { assetName: asset.label } : {}),
        ...(e.cost !== undefined ? { cost: e.cost } : {}),
      };
    }),
  };

  const latest = picked[0];
  const text = latest
    ? plain(`${picked.length === 1 ? "I found one entry." : `I found ${picked.length} entries.`} The most recent is on ${longMonthDay(isoDateIn(new Date(latest.ts), home.timezone))}: ${latest.summary.replace(/[.\s]+$/, "")}.`)
    : "I don't have anything in your home timeline that matches that yet.";
  return { output, text };
}
