import type { PartsApi } from "@hearth/contracts";

/** Stub frozen at G0. Lane A1 replaces the bodies; the exported shape must not change. */
const notBuilt = (): never => { throw new Error("not_built: @hearth/parts-catalog"); };

export const parts: PartsApi = {
  listCatalog: notBuilt,
  getSku: notBuilt,
  findExactParts: notBuilt,
  listRecalls: notBuilt,
};
