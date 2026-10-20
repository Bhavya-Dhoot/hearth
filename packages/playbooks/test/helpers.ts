import { readFileSync } from "node:fs";
import { SeedFile, type Asset } from "@hearth/contracts";

export const MCP_BASE = "http://localhost:4200";

/** The Okafor House assets, read from the home-graph seed with the media base resolved. */
export const seedAssets: Asset[] = SeedFile.parse(
  JSON.parse(readFileSync(new URL("../../home-graph/seed/okafor-house.json", import.meta.url), "utf8").replaceAll("{{MCP_BASE}}", MCP_BASE)),
).assets;
