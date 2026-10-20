import { mediaUrl, type CatalogItem, type FindPartOutput, type PartItem, type PartsApi, type RecallRecord } from "@hearth/contracts";

const item = (i: Omit<CatalogItem, "fits" | "brand" | "image"> & Partial<CatalogItem>): CatalogItem => ({ fits: {}, brand: "Hearth Supply", image: "part-slip-washer.svg", ...i });

const CATALOG: CatalogItem[] = [
  item({ sku: "HR-PT-150-WSH", name: "1-1/2 inch slip-joint washer kit", partRole: "ptrap_washer", price: 4.29, shipDays: 2, fits: { trapSize: "1-1/2", joint: "slip" } }),
  item({ sku: "HR-PT-150-WSH-B", name: "1-1/2 inch beveled washer, 2 pack", partRole: "ptrap_washer", price: 5.49, shipDays: 2, fits: { trapSize: "1-1/2", joint: "slip" } }),
  item({ sku: "HR-PT-125-WSH", name: "1-1/4 inch slip-joint washer kit", partRole: "ptrap_washer", price: 3.99, shipDays: 3, fits: { trapSize: "1-1/4" }, compatible: { joint: "slip" } }),
  item({ sku: "HR-FLT-16251", name: "Furnace filter 16x25x1 MERV 11", partRole: "furnace_filter", price: 14.99, shipDays: 1, image: "part-hvac-filter.svg", fits: { filterSize: "16x25x1" } }),
  item({ sku: "HR-FRG-UKF8001", name: "Refrigerator water filter UKF8001", partRole: "fridge_filter", price: 49.99, shipDays: 3, image: "part-fridge-filter.svg" }),
  item({ sku: "HR-9V-BATT", name: "9V alkaline battery, 4 pack", partRole: "9v_battery", price: 8.99, shipDays: 1, image: "part-9v-battery.svg" }),
];

const RECALLS: RecallRecord[] = [
  {
    recallId: "RC-SAMPLE-DW-001",
    brand: "Bosch",
    modelPattern: "^SHEM63W55N$",
    title: "Dishwasher control board overheating",
    hazard: "A control board can overheat during the heated dry cycle.",
    remedy: ["Stop using the heated dry cycle.", "Request a free replacement board from the manufacturer."],
    isSample: true,
  },
];

/** A scripted stand-in for @hearth/parts-catalog that honours the PartsApi contract. */
export const fakeParts: PartsApi = {
  listCatalog: () => CATALOG,
  getSku: (sku) => CATALOG.find((c) => c.sku === sku),
  listRecalls: () => RECALLS,
  findExactParts(q, ctx): FindPartOutput {
    const matches = CATALOG.filter((c) => c.partRole === q.partRole);
    if (matches.length === 0) throw new Error("no_parts");
    const items: PartItem[] = matches.slice(0, 5).map((c, idx) => ({
      sku: c.sku,
      name: c.name,
      price: c.price,
      currency: "USD",
      image: mediaUrl(ctx.mcpBase, c.image),
      fitReason: q.asset ? `fits your ${q.asset.label}, installed ${q.asset.installDate?.slice(0, 4) ?? "earlier"}` : "fits most standard fixtures",
      confidence: idx === 0 ? 0.95 : 0.7,
      etaDate: "2026-10-23",
      badge: idx === 0 ? "EXACT FIT" : "COMPATIBLE",
    }));
    return { title: "Parts that fit", partRole: q.partRole, ...(q.asset ? { assetLabel: q.asset.label } : {}), items, selectedIndex: 0 };
  },
};
