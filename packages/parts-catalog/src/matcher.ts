import { mediaUrl } from "@hearth/contracts";
import type { Asset, CatalogItem, FindPartOutput, PartItem } from "@hearth/contracts";
import { CATALOG } from "./catalog";
import { attributeLabel, describeValue, joinLabels, roleCopy } from "./format";

const MIN_ITEMS = 3;
const MAX_ITEMS = 5;

type Fit = "exact" | "compatible" | "closest" | "unknown";

type Constraints = Readonly<Record<string, string | number>>;

const same = (a: unknown, b: string | number): boolean => String(a).toLowerCase() === String(b).toLowerCase();

/** True when the asset carries every constrained attribute with an equal value. */
function satisfies(asset: Asset, constraints: Constraints): boolean {
  return Object.entries(constraints).every(([key, value]) => {
    const have = asset.attributes[key];
    return have !== undefined && same(have, value);
  });
}

function classify(item: CatalogItem, asset: Asset | undefined): Fit {
  if (!asset) return "unknown";
  if (satisfies(asset, item.fits)) return "exact";
  if (item.compatible && satisfies(asset, item.compatible)) return "compatible";
  return "closest";
}

/** The asset's own values for `keys`, phrased for the customer: "1½″ slip-joint". */
function describeAsset(asset: Asset, keys: readonly string[]): string {
  const parts: string[] = [];
  for (const key of keys) {
    const value = asset.attributes[key];
    if (value !== undefined) parts.push(describeValue(key, value));
  }
  return parts.join(" ");
}

function mismatched(item: CatalogItem, asset: Asset): string[] {
  return Object.entries(item.fits)
    .filter(([key, value]) => asset.attributes[key] === undefined || !same(asset.attributes[key], value))
    .map(([key]) => attributeLabel(key));
}

function installed(asset: Asset): string {
  return asset.installDate ? `, installed ${asset.installDate.slice(0, 4)}` : "";
}

/** "fits your 1½″ slip-joint P-trap, installed 2019" and its compatible/closest/unknown variants. */
function fitReason(item: CatalogItem, asset: Asset | undefined, fit: Fit): string {
  const { noun } = roleCopy(item.partRole);
  if (!asset || fit === "unknown") return `fits most homes. Say 'add my ${noun}' and I'll match it exactly.`;
  const spoken = (keys: readonly string[]): string => [describeAsset(asset, keys), noun].filter(Boolean).join(" ");
  if (fit === "exact") return `fits your ${spoken(Object.keys(item.fits))}${installed(asset)}`;
  const check = joinLabels(mismatched(item, asset));
  if (fit === "compatible") return `works with your ${spoken(Object.keys(item.compatible ?? {}))}${installed(asset)}, but check the ${check} before you order`;
  return `closest match for a ${noun}, so confirm the ${check} on your ${asset.label} before you order`;
}

function confidence(fit: Fit, rank: number): number {
  switch (fit) {
    case "exact": return Math.max(0.9, 0.98 - 0.02 * rank);
    case "compatible": return Math.max(0.6, 0.78 - 0.03 * rank);
    case "unknown": return 0.6;
    case "closest": return Math.max(0.3, 0.5 - 0.05 * rank);
  }
}

/** ctx.now plus `shipDays` days, not counting Sundays. UTC calendar date, YYYY-MM-DD. */
export function etaDate(now: Date, shipDays: number): string {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (let remaining = shipDays; remaining > 0; ) {
    day.setUTCDate(day.getUTCDate() + 1);
    if (day.getUTCDay() !== 0) remaining--;
  }
  return day.toISOString().slice(0, 10);
}

/**
 * Exact fits first, then compatible, then (only if fewer than three) the closest same-role parts,
 * each labelled honestly. Without an asset nothing can be confirmed, so every item is COMPATIBLE.
 */
export function findExactParts(
  q: { partRole: string; asset?: Asset | undefined },
  ctx: { mcpBase: string; now: Date },
): FindPartOutput {
  const forRole = CATALOG.filter((item) => item.partRole === q.partRole);
  if (forRole.length === 0) throw new Error("no_parts");

  const graded = forRole.map((item) => ({ item, fit: classify(item, q.asset) }));
  const tier = (fit: Fit): CatalogItem[] => graded.filter((g) => g.fit === fit).map((g) => g.item);
  const ordered: Array<{ item: CatalogItem; fit: Fit }> = [
    ...tier("exact").map((item) => ({ item, fit: "exact" as const })),
    ...tier("compatible").map((item) => ({ item, fit: "compatible" as const })),
    ...tier("unknown").map((item) => ({ item, fit: "unknown" as const })),
  ];
  if (ordered.length < MIN_ITEMS) ordered.push(...tier("closest").map((item) => ({ item, fit: "closest" as const })));

  const rankInTier = new Map<Fit, number>();
  const items: PartItem[] = ordered.slice(0, MAX_ITEMS).map(({ item, fit }) => {
    const rank = rankInTier.get(fit) ?? 0;
    rankInTier.set(fit, rank + 1);
    return {
      sku: item.sku,
      name: item.name,
      price: item.price,
      currency: "USD",
      image: mediaUrl(ctx.mcpBase, item.image),
      fitReason: fitReason(item, q.asset, fit),
      confidence: Number(confidence(fit, rank).toFixed(2)),
      etaDate: etaDate(ctx.now, item.shipDays),
      badge: fit === "exact" ? "EXACT FIT" : "COMPATIBLE",
    };
  });

  const { title } = roleCopy(q.partRole);
  return {
    title: q.asset ? `${title} for your ${q.asset.label}` : title,
    partRole: q.partRole,
    ...(q.asset ? { assetLabel: q.asset.label } : {}),
    items,
    selectedIndex: 0,
  };
}
