import type { PartsApi } from "@hearth/contracts";
import { BY_SKU, CATALOG, RECALLS } from "./catalog";
import { findExactParts } from "./matcher";

/** The seeded parts catalogue (about 60 house-brand SKUs), the exact-fit matcher and the sample recall set. */
export const parts: PartsApi = {
  listCatalog: () => [...CATALOG],
  getSku: (sku) => BY_SKU.get(sku),
  findExactParts,
  listRecalls: () => [...RECALLS],
};
