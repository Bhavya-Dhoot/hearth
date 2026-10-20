import type { Asset } from "@hearth/contracts";

/**
 * Placeholder rendering for playbook text. A placeholder is `{key}` or `{key|fallback}`:
 *   {asset.model}        model of the playbook's own asset          {asset.brand} {asset.label}
 *   {asset.name}         brand and model, or the label              {asset.location}
 *   {asset.ageYears}     whole years since installDate              {asset.ageSentence}
 *   {shutoff.location}   location of the asset the step shows a photo of
 * `{asset.ageSentence}` renders a full sentence ("Your InSinkErator Badger 5 is 9 years old.").
 * When a value is unknown the fallback is used; playbook loading rejects placeholders without one.
 */

export interface TemplateScope {
  /** The asset the playbook is about, if the home has one. */
  asset?: Asset | undefined;
  /** The asset the step shows a photo of, if the home has one. */
  shutoff?: Asset | undefined;
  /** Calendar year used for age-based text. */
  year: number;
}

export const PLACEHOLDER_KEYS = [
  "asset.model",
  "asset.brand",
  "asset.label",
  "asset.name",
  "asset.location",
  "asset.ageYears",
  "asset.ageSentence",
  "shutoff.location",
] as const;
export type PlaceholderKey = (typeof PLACEHOLDER_KEYS)[number];

export const PLACEHOLDER_PATTERN = /\{([a-zA-Z.]+)(?:\|([^}]*))?\}/g;

const ARTICLES = new Set(["the", "a", "an"]);

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** "in your kitchen, under the sink": the room, plus the note when it is short enough to read aloud. */
export function describeLocation(asset: Asset): string {
  const room = `in your ${asset.location.room.toLowerCase()}`;
  const note = asset.location.note?.trim();
  return note && note.split(/\s+/).length <= 5 ? `${room}, ${lowerFirst(note)}` : room;
}

/** Short upper-case place for the location chip: "UNDER SINK", or the room when the note is long. */
export function chipPlace(asset: Asset): string {
  const note = asset.location.note?.trim();
  if (note) {
    const words = note.split(/\s+/).filter((word) => !ARTICLES.has(word.toLowerCase()));
    if (words.length > 0 && words.length <= 2) return words.join(" ").toUpperCase();
  }
  return asset.location.room.toUpperCase();
}

/** Noun for the location chip: "VALVE", "PANEL", "DISPOSAL", "P-TRAP". */
export function chipNoun(asset: Asset): string {
  if (asset.type === "shutoff") return "VALVE";
  if (asset.type === "panel") return "PANEL";
  const words = asset.label.trim().split(/\s+/);
  return (words.length <= 2 ? asset.label.trim() : words[words.length - 1]!).toUpperCase();
}

function assetName(asset: Asset): string {
  const parts = [asset.brand, asset.model].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" ") : asset.label;
}

function ageYears(asset: Asset, year: number): number | undefined {
  const installed = asset.installDate ? Number(asset.installDate.slice(0, 4)) : Number.NaN;
  return Number.isInteger(installed) && year >= installed ? year - installed : undefined;
}

function resolve(key: string, scope: TemplateScope): string | undefined {
  const { asset, shutoff, year } = scope;
  switch (key) {
    case "asset.model": return asset?.model;
    case "asset.brand": return asset?.brand;
    case "asset.label": return asset?.label;
    case "asset.name": return asset ? assetName(asset) : undefined;
    case "asset.location": return asset ? describeLocation(asset) : undefined;
    case "asset.ageYears": return asset ? ageYears(asset, year)?.toString() : undefined;
    case "asset.ageSentence": {
      const years = asset ? ageYears(asset, year) : undefined;
      if (!asset || years === undefined) return undefined;
      return `Your ${assetName(asset)} is ${years} ${years === 1 ? "year" : "years"} old.`;
    }
    case "shutoff.location": return shutoff ? describeLocation(shutoff) : undefined;
    default: return undefined;
  }
}

/** Replace every placeholder in `template`; unknown values fall back, then collapse stray spaces. */
export function renderTemplate(template: string, scope: TemplateScope): string {
  return template
    .replace(PLACEHOLDER_PATTERN, (_match, key: string, fallback: string | undefined) => resolve(key, scope) ?? fallback ?? "")
    .replace(/ {2,}/g, " ")
    .trim();
}
