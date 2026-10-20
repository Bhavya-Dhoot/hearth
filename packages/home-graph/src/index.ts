import type { HomeRepository } from "@hearth/contracts";

/** Stub frozen at G0. Lane A1 implements MemoryRepo (JSON file) + DynamoRepo and the seed loader. */
export function createRepo(_opts?: { dataFile?: string; tableName?: string }): HomeRepository {
  throw new Error("not_built: @hearth/home-graph createRepo");
}
/** Idempotently loads "The Okafor House" (Appendix C) with dates relative to `now`. */
export async function loadSeed(_repo: HomeRepository, _opts?: { now?: Date; mcpBase?: string }): Promise<void> {
  throw new Error("not_built: @hearth/home-graph loadSeed");
}
