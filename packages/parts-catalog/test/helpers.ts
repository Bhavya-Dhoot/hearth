import { readFileSync } from "node:fs";
import { SeedFile, type Asset } from "@hearth/contracts";

export const MCP_BASE = "http://localhost:4200";

const seed = SeedFile.parse(
  JSON.parse(readFileSync(new URL("../../home-graph/seed/okafor-house.json", import.meta.url), "utf8").replaceAll("{{MCP_BASE}}", MCP_BASE)),
);

/** The Okafor House, read from the home-graph seed with the media base resolved. */
export const seedAssets: Asset[] = seed.assets;
export const seedTasks = seed.tasks;

export const assetById = (assetId: string): Asset => {
  const asset = seedAssets.find((a) => a.assetId === assetId);
  if (!asset) throw new Error(`seed has no ${assetId}`);
  return asset;
};

/** 2026-10-21, a Wednesday, noon in Austin. */
export const NOW = new Date("2026-10-21T17:00:00Z");
