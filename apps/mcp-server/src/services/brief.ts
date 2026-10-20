import {
  ProBriefOutput as ProBriefOutputSchema,
  type Asset,
  type HomeEvent,
  type Issue,
  type ProBriefInput,
  type ProBriefOutput,
  type ProBriefRow,
  type SafetyCategory,
} from "@hearth/contracts";
import { fail } from "../errors";
import { type Core, type Ctx, assetByCategory, locationText, newId, newToken, once, todayFor } from "./core";
import { ageInYears } from "./dates";
import { capitalize, plain, truncate } from "./format";

type Trade = ProBriefOutput["trade"];

const HANDOFF: Record<Trade, string> = {
  plumber: "Want me to find a plumber?",
  electrician: "Want me to find an electrician?",
  hvac: "Want me to find an HVAC technician?",
  appliance: "Want me to find an appliance repair technician?",
  gas_utility: "Want me to help you reach your gas company?",
  general: "Want me to find a handyman?",
};

const HARD_STOP_TRADE: Record<SafetyCategory, Trade> = {
  gas: "gas_utility",
  electrical: "electrician",
  flooding: "plumber",
  sewage: "plumber",
  structural: "general",
};

function tradeFromAsset(asset: Asset | undefined): Trade {
  if (!asset) return "general";
  const hay = `${asset.category} ${asset.label}`.toLowerCase();
  if (/(trap|disposal|sink|toilet|faucet|pipe|shut.?off|water heater|plumb|drain)/.test(hay)) return "plumber";
  if (/(panel|breaker|outlet|electric|wiring)/.test(hay)) return "electrician";
  if (/(furnace|hvac|air cond|\bac\b|condenser|thermostat|heat pump)/.test(hay)) return "hvac";
  if (/(dishwasher|washer|dryer|fridge|refrigerator|oven|range|microwave)/.test(hay)) return "appliance";
  return "general";
}

/** The shut-off a pro should reach first: same room as the asset, else the main one, else any. */
function nearestShutoff(assets: Asset[], asset: Asset | undefined): Asset | undefined {
  const shutoffs = assets.filter((a) => a.type === "shutoff");
  if (asset) {
    const sameRoom = shutoffs.find((s) => s.location.room.toLowerCase() === asset.location.room.toLowerCase());
    if (sameRoom) return sameRoom;
  }
  return shutoffs.find((s) => /\bmain\b/i.test(s.label)) ?? shutoffs[0];
}

function accessNotes(asset: Asset | undefined, shutoff: Asset | undefined): string {
  if (!asset) return "Access details are not on file yet. The customer can show the pro where the problem is.";
  const parts = [`The ${asset.label} is at ${locationText(asset).toLowerCase()}.`];
  if (shutoff && shutoff.assetId !== asset.assetId) parts.push(`Nearest shut-off: ${shutoff.label}, ${locationText(shutoff).toLowerCase()}.`);
  return plain(parts.join(" "));
}

export async function prepareProBrief(core: Core, ctx: Ctx, input: ProBriefInput): Promise<{ output: ProBriefOutput; text: string }> {
  const output = await once(core, ctx.userId, "prepare_pro_brief", input.idempotencyKey, ProBriefOutputSchema, async () => {
    const { home } = ctx;
    const assets = await core.repo.listAssets(home.homeId);
    const today = todayFor(core, home);

    const playbook = input.issueId ? core.playbooks.getPlaybook(input.issueId) : undefined;
    let asset: Asset | undefined;
    if (input.assetId) {
      asset = assets.find((a) => a.assetId === input.assetId);
      if (!asset) throw fail("not_found", "I couldn't find that item in your home, so I can't put the brief together yet.");
    } else {
      asset = assetByCategory(assets, playbook?.assetCategory);
    }

    const hardStop = core.playbooks.checkHardStop(input.symptom);
    const trade: Trade = hardStop.hardStop && hardStop.category ? HARD_STOP_TRADE[hardStop.category] : (playbook?.trade ?? tradeFromAsset(asset));

    const shutoff = nearestShutoff(assets, asset);
    const history = asset ? await core.repo.listEvents(home.homeId, { assetId: asset.assetId, limit: 5 }) : [];
    const timeline = [
      ...[...history].reverse().map((e) => ({ ts: e.ts.slice(0, 10), text: plain(e.summary) })),
      { ts: today, text: plain(`Reported: ${input.symptom}`) },
    ];

    const photos = [...new Set([...(asset?.photos ?? []), ...(shutoff?.photos ?? [])].map((p) => p.url).concat(history.flatMap((e) => e.photos)))].slice(0, 4);

    const briefId = newId("brief");
    const publicToken = newToken();
    const shareUrl = `${core.mcpBase}/briefs/${publicToken}`;
    const lead = asset ? capitalize(asset.label) : "Home repair";

    const brief: ProBriefOutput = {
      briefId,
      headline: plain(`${lead}: ${truncate(input.symptom.trim(), 80)}`),
      trade,
      asset: { brand: asset?.brand ?? "Unknown", model: asset?.model ?? "Unknown", ageYears: ageInYears(asset?.installDate, today) },
      symptom: plain(input.symptom.trim()),
      timeline,
      attempted: (input.attempted ?? []).map(plain),
      accessNotes: accessNotes(asset, shutoff),
      photos,
      shareUrl,
      qrPayload: shareUrl,
      handoffLine: HANDOFF[trade],
    };

    const at = core.now().toISOString();
    const row: ProBriefRow = {
      homeId: home.homeId,
      briefId,
      ts: at,
      ...(asset ? { assetId: asset.assetId } : {}),
      ...(input.issueId ? { issueId: input.issueId } : {}),
      payload: { ...brief },
      publicToken,
    };
    await core.repo.putBrief(row);

    const issue: Issue = {
      homeId: home.homeId,
      issueRecordId: newId("iss"),
      ts: at,
      symptomText: plain(input.symptom.trim()),
      playbookId: input.issueId ?? null,
      ...(asset ? { assetId: asset.assetId } : {}),
      status: "escalated",
      answers: {},
      stepsCompleted: 0,
    };
    await core.repo.putIssue(issue);

    const event: HomeEvent = {
      homeId: home.homeId,
      eventId: newId("evt"),
      ts: at,
      type: "escalation",
      ...(asset ? { assetId: asset.assetId } : {}),
      summary: plain(truncate(`Prepared a job brief for a ${trade.replace("_", " ")}: ${input.symptom.trim()}`, 160)),
      photos: [],
    };
    await core.repo.putEvent(event);
    return brief;
  });

  const lead = output.headline.split(":")[0] ?? "";
  const subject = lead === "Home repair" || lead === "" ? "the pro" : `your ${lead.charAt(0).toLowerCase()}${lead.slice(1)}`;
  return { output, text: `I've put together a job brief for ${subject}. ${output.handoffLine}` };
}
