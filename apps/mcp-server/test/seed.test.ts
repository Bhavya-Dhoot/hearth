import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SeedFile, WeekendPlanOutput, HomeProfileOutput, RecallsOutput, type CatalogItem, type PartsApi, type RecallRecord } from "@hearth/contracts";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fakeParts } from "./fixtures/fakeParts";
import { type Harness, startHarness } from "./fixtures/harness";
import type { MemoryRepo } from "./fixtures/memoryRepo";

/**
 * Runs the server against the home-graph lane's real seed file (packages/home-graph/seed/okafor-house.json),
 * so a change to that seed or to the contracts shows up here. Skipped if the file is absent.
 */
const seedPath = fileURLToPath(new URL("../../../packages/home-graph/seed/okafor-house.json", import.meta.url));
const present = existsSync(seedPath);

function load(mcpBase: string): SeedFile {
  const raw = readFileSync(seedPath, "utf8").replaceAll("{{MCP_BASE}}", mcpBase);
  return SeedFile.parse(JSON.parse(raw));
}

/** The default fake catalogue plus a part for every SKU the real seed mentions, and its recall. */
function partsFor(seed: SeedFile): PartsApi {
  const extra: CatalogItem[] = [];
  const recalls: RecallRecord[] = [];
  const skus = new Set([...seed.assets.flatMap((a) => a.consumables.map((c) => c.sku)), ...seed.tasks.flatMap((t) => (t.reorderSku ? [t.reorderSku] : []))]);
  for (const sku of skus) {
    const label = seed.assets.flatMap((a) => a.consumables).find((c) => c.sku === sku)?.label ?? sku;
    extra.push({ sku, name: label, partRole: "consumable", price: 9.99, image: "part-hvac-filter.svg", fits: {}, brand: "Hearth Supply", shipDays: 1 });
  }
  for (const asset of seed.assets) {
    for (const recallId of asset.recallIds) {
      recalls.push({ recallId, brand: asset.brand ?? "", modelPattern: asset.model ?? ".*", title: "Sample recall notice", hazard: "Sample hazard text.", remedy: ["Stop using it."], isSample: true });
    }
  }
  return {
    ...fakeParts,
    listCatalog: () => [...fakeParts.listCatalog(), ...extra],
    getSku: (sku) => fakeParts.getSku(sku) ?? extra.find((c) => c.sku === sku),
    listRecalls: () => recalls,
  };
}

describe.skipIf(!present)("real Okafor seed", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({
      // Only SKUs and recall ids are read from this copy, so the base URL placeholder does not matter.
      parts: partsFor(load("http://localhost:4200")),
      seed: async (repo: MemoryRepo, base: string) => {
        const seed = load(base);
        await repo.putHome(seed.home);
        for (const asset of seed.assets) await repo.putAsset(asset);
        for (const event of seed.events) await repo.putEvent(event);
        for (const task of seed.tasks) await repo.putTask(task);
      },
    });
  });
  afterAll(async () => {
    await h.close();
  });

  const call = async (name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> => (await (await h.connect()).callTool({ name, arguments: args })) as CallToolResult;

  it("validates against the SeedFile contract", () => {
    const seed = load("http://localhost:4200");
    expect(seed.assets).toHaveLength(12);
    expect(seed.home.userId).toBe("usr_okafor");
  });

  it("describes the house", async () => {
    const d = HomeProfileOutput.parse((await call("get_home_profile")).structuredContent);
    expect(d.assetCount).toBe(12);
    expect(d.keyLocations[0]?.label).toBe("main water shut-off");
  });

  it("puts the 16x25x1 furnace filter, 94 days old, at the top of the weekend plan on 2026-10-21", async () => {
    const plan = WeekendPlanOutput.parse((await call("get_weekend_plan")).structuredContent);
    expect(plan.weekendLabel).toBe("Oct 24-25");
    const [first] = plan.tasks;
    expect(first?.title).toContain("16x25x1");
    expect(first?.why).toContain("94 days");
    expect(first?.action).toEqual({ type: "reorder", sku: "HR-FF-162501-M11-2" });
    expect(plan.tasks.some((t) => /recall/i.test(t.title))).toBe(true);
    expect(plan.tasks.some((t) => /gutters/i.test(t.title) && t.dueState === "seasonal")).toBe(true);
    expect(plan.tasks.length).toBeLessThanOrEqual(6);
    const ids = plan.tasks.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Scheduled tasks that duplicate a consumable row or the recall row must not be listed twice.
    expect(plan.tasks.filter((t) => /furnace filter/i.test(t.title))).toHaveLength(1);
    expect(plan.tasks.filter((t) => /recall/i.test(t.title))).toHaveLength(1);
  });

  it("flags the seeded dishwasher recall", async () => {
    const d = RecallsOutput.parse((await call("check_recalls")).structuredContent);
    expect(d.flagged.map((f) => f.assetId)).toEqual(["asset_dishwasher"]);
  });
});
