import { join } from "node:path";
import type { HomeRepository } from "@hearth/contracts";
import { DynamoRepo } from "./dynamo-repo";
import { MemoryRepo } from "./memory-repo";

export { DynamoRepo } from "./dynamo-repo";
export { MemoryRepo } from "./memory-repo";
export { loadSeed } from "./seed";

/**
 * Pick the repository (docs/DECISIONS.md #8). An explicit `tableName` selects DynamoDB and an
 * explicit `dataFile` selects the JSON file; otherwise HEARTH_DDB_TABLE selects DynamoDB, and the
 * fallback is the JSON file at HEARTH_DATA_FILE or `<cwd>/.data/home-graph.json`.
 */
export function createRepo(opts?: { dataFile?: string; tableName?: string }): HomeRepository {
  const table = opts?.tableName || (opts?.dataFile ? undefined : process.env.HEARTH_DDB_TABLE || undefined);
  if (table) return new DynamoRepo(table);
  return new MemoryRepo(opts?.dataFile || process.env.HEARTH_DATA_FILE || join(process.cwd(), ".data", "home-graph.json"));
}
