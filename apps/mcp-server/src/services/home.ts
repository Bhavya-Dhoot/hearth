import type { Asset, AddAssetInput, AddAssetOutput, HomeEvent, HomeProfileOutput } from "@hearth/contracts";
import { AddAssetOutput as AddAssetOutputSchema } from "@hearth/contracts";
import { fail } from "../errors";
import { type Core, type Ctx, locationText, newId, once } from "./core";
import { plural, slug } from "./format";

const KEY_TYPE_ORDER: Record<Asset["type"], number> = { shutoff: 0, panel: 1, hvac: 2, appliance: 3, fixture: 4, consumable: 5 };
const isMain = (a: Asset): number => (/\bmain\b/i.test(a.label) ? 0 : 1);

/** Shut-offs and the panel first (main shut-off leading), then the systems people ask about. */
function pickKeyLocations(assets: Asset[], mustInclude?: string): Asset[] {
  const ranked = [...assets].sort((a, b) => KEY_TYPE_ORDER[a.type] - KEY_TYPE_ORDER[b.type] || isMain(a) - isMain(b) || a.label.localeCompare(b.label));
  const top = ranked.slice(0, 6);
  const pinned = mustInclude ? ranked.find((a) => a.assetId === mustInclude) : undefined;
  if (pinned && !top.includes(pinned)) top[top.length - 1] = pinned;
  return top;
}

export async function buildHomeProfile(core: Core, ctx: Ctx, highlight?: HomeProfileOutput["highlight"]): Promise<HomeProfileOutput> {
  const { home } = ctx;
  const [assets, events, issues] = await Promise.all([
    core.repo.listAssets(home.homeId),
    core.repo.listEvents(home.homeId, { limit: 3 }),
    core.repo.listIssues(home.homeId),
  ]);
  const inventoryByType: Record<string, number> = {};
  for (const a of assets) inventoryByType[a.type] = (inventoryByType[a.type] ?? 0) + 1;

  return {
    homeId: home.homeId,
    name: home.name,
    city: home.city,
    state: home.state,
    yearBuilt: home.yearBuilt,
    assetCount: assets.length,
    inventoryByType,
    keyLocations: pickKeyLocations(assets, highlight?.assetId).map((a) => ({
      assetId: a.assetId,
      label: a.label,
      location: locationText(a),
      ...(a.photos[0] ? { photoUrl: a.photos[0].url } : {}),
    })),
    recentEvents: events.slice(0, 3).map((e) => ({ ts: e.ts, type: e.type, summary: e.summary })),
    openIssues: issues
      .filter((i) => i.status !== "resolved")
      .map((i) => ({ issueRecordId: i.issueRecordId, title: i.symptomText, status: i.status })),
    ...(highlight ? { highlight } : {}),
  };
}

export function homeSpeech(profile: HomeProfileOutput): string {
  const lead = `I remember ${plural(profile.assetCount, "thing")} in your home.`;
  const main = profile.keyLocations[0];
  if (!main) return `${lead} Tell me what to add, like your water shut-off.`;
  const place = /^outside\b/i.test(main.location) ? main.location.toLowerCase() : `in the ${main.location.charAt(0).toLowerCase()}${main.location.slice(1)}`;
  return `${lead} Your ${main.label} is ${place}.`;
}

export async function getHomeProfile(core: Core, ctx: Ctx): Promise<{ output: HomeProfileOutput; text: string }> {
  const output = await buildHomeProfile(core, ctx);
  return { output, text: homeSpeech(output) };
}

const normCategory = (c: string): string => slug(c);
const sameRoom = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

function uniqueAssetId(assets: Asset[], category: string, room: string): string {
  const base = `asset_${category}_${slug(room)}`;
  const taken = new Set(assets.map((a) => a.assetId));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

export async function addAsset(core: Core, ctx: Ctx, input: AddAssetInput): Promise<{ output: AddAssetOutput; text: string }> {
  const output = await once(core, ctx.userId, "add_asset", input.idempotencyKey, AddAssetOutputSchema, async () => {
    const { home } = ctx;
    const assets = await core.repo.listAssets(home.homeId);
    const category = normCategory(input.category);

    let existing: Asset | undefined;
    if (input.assetId) {
      existing = assets.find((a) => a.assetId === input.assetId);
      if (!existing) throw fail("not_found", "I couldn't find that item to update. Want me to add it as something new?");
    } else {
      existing = assets.find((a) => a.category === category && sameRoom(a.location.room, input.location.room));
    }

    const at = core.now().toISOString();
    const photos = [...(existing?.photos ?? [])];
    if (input.photoUrl && !photos.some((p) => p.url === input.photoUrl)) photos.push({ url: input.photoUrl, alt: `${input.label} label photo` });

    const brand = input.brand ?? existing?.brand;
    const model = input.model ?? existing?.model;
    const serial = input.serial ?? existing?.serial;
    const installDate = input.installYear !== undefined ? `${input.installYear}-01-01` : existing?.installDate;
    const note = input.location.note ?? existing?.location.note;

    const asset: Asset = {
      homeId: home.homeId,
      assetId: existing?.assetId ?? uniqueAssetId(assets, category, input.location.room),
      type: input.type,
      category: existing?.category ?? category,
      label: input.label,
      ...(brand !== undefined ? { brand } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(serial !== undefined ? { serial } : {}),
      ...(installDate !== undefined ? { installDate } : {}),
      location: { room: input.location.room, ...(note !== undefined ? { note } : {}) },
      photos,
      attributes: { ...(existing?.attributes ?? {}), ...(input.attributes ?? {}) },
      consumables: existing?.consumables ?? [],
      recallIds: existing?.recallIds ?? [],
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    };
    await core.repo.putAsset(asset);

    if (!existing) {
      const event: HomeEvent = {
        homeId: home.homeId,
        eventId: newId("evt"),
        ts: at,
        type: "added_asset",
        assetId: asset.assetId,
        summary: `Added ${asset.label} in the ${asset.location.room.toLowerCase()}.`,
        photos: input.photoUrl ? [input.photoUrl] : [],
      };
      await core.repo.putEvent(event);
    }

    const profile = await buildHomeProfile(core, ctx, { assetId: asset.assetId, label: asset.label, created: !existing });
    return profile;
  });

  const highlight = output.highlight;
  const saved = highlight ? await core.repo.getAsset(ctx.home.homeId, highlight.assetId) : null;
  const where = saved ? ` in the ${saved.location.room.toLowerCase()}` : "";
  const text = highlight?.created
    ? `Got it. I've saved your ${highlight.label}${where}. I now remember ${plural(output.assetCount, "thing")} in your home.`
    : `Okay, I've updated your ${highlight?.label ?? "item"}${where}.`;
  return { output, text };
}
