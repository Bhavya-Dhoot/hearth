import { CatalogItem, PART_MEDIA, RecallRecord } from "@hearth/contracts";
import catalogJson from "../data/catalog.json";
import recallsJson from "../data/recalls.json";

const DASHES = /[\u2012\u2013\u2014\u2015\u2212]/;

/** Validate catalogue rows: schema, unique SKUs, known illustration, no en or em dash. Fails loudly. */
export function parseCatalog(raw: unknown): CatalogItem[] {
  const items = CatalogItem.array().parse(raw);
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.sku)) throw new Error(`Duplicate catalogue SKU ${item.sku}`);
    seen.add(item.sku);
    if (!(PART_MEDIA as readonly string[]).includes(item.image)) throw new Error(`SKU ${item.sku} uses unknown part image "${item.image}"`);
    if (DASHES.test(item.name)) throw new Error(`SKU ${item.sku} name contains an en dash or em dash`);
  }
  return items;
}

/** Validate recall rows: schema, unique ids, valid regex, sample label on every title. */
export function parseRecalls(raw: unknown): RecallRecord[] {
  const records = RecallRecord.array().parse(raw);
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.recallId)) throw new Error(`Duplicate recall ${record.recallId}`);
    seen.add(record.recallId);
    new RegExp(record.modelPattern);
    if (!record.title.startsWith("SAMPLE RECALL (demo data, not a real notice):")) throw new Error(`Recall ${record.recallId} is not labelled as a sample`);
    if (DASHES.test(record.title) || DASHES.test(record.hazard) || record.remedy.some((step) => DASHES.test(step))) {
      throw new Error(`Recall ${record.recallId} contains an en dash or em dash`);
    }
  }
  return records;
}

export const CATALOG: readonly CatalogItem[] = parseCatalog(catalogJson);
export const RECALLS: readonly RecallRecord[] = parseRecalls(recallsJson);
export const BY_SKU: ReadonlyMap<string, CatalogItem> = new Map(CATALOG.map((item) => [item.sku, item]));
