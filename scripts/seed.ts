import { createRepo, loadSeed } from "@hearth/home-graph";

/**
 * `pnpm seed`: load "The Okafor House" (PRD Appendix C) into the Home Graph.
 *
 * The repository follows the environment: HEARTH_DDB_TABLE selects DynamoDB, otherwise the JSON
 * file at HEARTH_DATA_FILE (default `.data/home-graph.json`). HEARTH_MCP_BASE is the public base
 * URL of the MCP server, used for the seed photo URLs. Dates are shifted so the demo reads the same
 * today as it did on 2026-10-21. Running it twice is safe.
 */
const USER_ID = "usr_okafor";
const mcpBase = process.env.HEARTH_MCP_BASE || "http://localhost:4200";

const repo = createRepo();
await loadSeed(repo, { now: new Date(), mcpBase });

const home = await repo.getHomeForUser(USER_ID);
if (!home) throw new Error(`Seed finished but no home was found for ${USER_ID}`);
const [assets, events, tasks] = await Promise.all([repo.listAssets(home.homeId), repo.listEvents(home.homeId), repo.listTasks(home.homeId)]);
const photos = assets.reduce((total, asset) => total + asset.photos.length, 0);

const target = process.env.HEARTH_DDB_TABLE ? `DynamoDB table ${process.env.HEARTH_DDB_TABLE}` : (process.env.HEARTH_DATA_FILE ?? ".data/home-graph.json");
console.log(`Seeded "${home.name}" (${home.city}, ${home.state}) into ${target}`);
console.log(`  assets: ${assets.length} (${photos} photos)`);
console.log(`  events: ${events.length}`);
console.log(`  tasks:  ${tasks.length}`);
console.log(`  media:  ${mcpBase}/media/`);
