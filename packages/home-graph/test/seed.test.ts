import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOME_MEDIA, SeedFile, type HomeRepository } from "@hearth/contracts";
import { afterAll, describe, expect, it } from "vitest";
import { DynamoRepo, MemoryRepo, loadSeed } from "../src";
import { buildSeed, dayShift, localDate, shiftDate } from "../src/seed";
import { FakeDoc } from "./fake-doc";

const rawText = readFileSync(new URL("../seed/okafor-house.json", import.meta.url), "utf8");
const root = mkdtempSync(join(tmpdir(), "hearth-seed-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const BASE = "http://localhost:4200";
const NOW_AUTHORED = new Date("2026-10-21T18:00:00Z"); // noon in Austin
const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

describe("seed/okafor-house.json (Appendix C)", () => {
  const seed = SeedFile.parse(JSON.parse(rawText.replaceAll("{{MCP_BASE}}", BASE)));

  it("is the Okafor house in Austin", () => {
    expect(seed.home).toEqual({
      userId: "usr_okafor",
      homeId: "home_okafor",
      name: "The Okafor House",
      city: "Austin",
      state: "TX",
      yearBuilt: 2004,
      climateZone: "2A",
      timezone: "America/Chicago",
      baths: 2,
      heatingFuel: "gas",
    });
  });

  it("holds twelve assets with stable ids and unique categories", () => {
    expect(seed.assets.map((a) => a.assetId)).toEqual([
      "asset_ptrap_kitchen", "asset_sink_shutoffs", "asset_disposal", "asset_dishwasher", "asset_fridge", "asset_furnace",
      "asset_ac_condenser", "asset_water_heater", "asset_main_shutoff", "asset_panel", "asset_washer", "asset_smoke_detectors",
    ]);
    expect(new Set(seed.assets.map((a) => a.category)).size).toBe(12);
    expect(seed.assets.every((a) => a.homeId === "home_okafor")).toBe(true);
  });

  it("carries the attributes the matcher and playbooks need", () => {
    const by = (id: string) => seed.assets.find((a) => a.assetId === id)!;
    expect(by("asset_ptrap_kitchen")).toMatchObject({ installDate: "2019-06-14", category: "ptrap", attributes: { trapSize: "1-1/2", joint: "slip", material: "PVC" } });
    expect(by("asset_disposal")).toMatchObject({ brand: "InSinkErator", model: "Badger 5" });
    expect(by("asset_disposal").installDate?.slice(0, 4)).toBe("2017");
    expect(by("asset_dishwasher")).toMatchObject({ brand: "Bosch", model: "SHEM63W55N", recallIds: ["SAMPLE-RC-DW-2026-001"] });
    expect(by("asset_dishwasher").installDate?.slice(0, 4)).toBe("2021");
    expect(by("asset_fridge").attributes.filterModel).toBe("UKF8001");
    expect(by("asset_fridge").consumables[0]).toMatchObject({ intervalDays: 180, lastReplaced: "2026-02-10" });
    expect(by("asset_furnace")).toMatchObject({ brand: "Carrier", model: "59SC2", attributes: { filterSize: "16x25x1", merv: 11 } });
    expect(by("asset_furnace").consumables[0]).toMatchObject({ intervalDays: 90, lastReplaced: "2026-07-19" });
    expect(by("asset_water_heater")).toMatchObject({ brand: "Rheem", attributes: { gallons: 50, fuel: "electric" } });
    expect(by("asset_water_heater").installDate?.slice(0, 4)).toBe("2018");
    expect(by("asset_washer")).toMatchObject({ brand: "LG" });
    expect(by("asset_washer").installDate?.slice(0, 4)).toBe("2020");
    expect(by("asset_smoke_detectors").attributes.batteryType).toBe("9V");
    expect(by("asset_smoke_detectors").consumables[0]?.intervalDays).toBe(365);
    expect(by("asset_main_shutoff").location).toEqual({ room: "Garage", note: "Left of the panel" });
  });

  it("uses the contract's alt text and annotation for the eight photos", () => {
    const photos = seed.assets.flatMap((a) => a.photos.map((p) => ({ asset: a.assetId, ...p })));
    expect(photos).toHaveLength(8);
    const expected: Record<string, string> = {
      asset_sink_shutoffs: "kitchen-sink-shutoffs.svg",
      asset_ptrap_kitchen: "kitchen-ptrap.svg",
      asset_main_shutoff: "main-shutoff-garage.svg",
      asset_panel: "electrical-panel.svg",
      asset_disposal: "disposal-reset.svg",
      asset_furnace: "furnace-filter-slot.svg",
      asset_water_heater: "water-heater-label.svg",
      asset_dishwasher: "dishwasher-filter.svg",
    };
    for (const photo of photos) {
      const file = expected[photo.asset] as keyof typeof HOME_MEDIA;
      expect(photo.url).toBe(`${BASE}/media/${file}`);
      expect(photo.alt).toBe(HOME_MEDIA[file].alt);
      expect(photo.annotation).toEqual(HOME_MEDIA[file].annotation);
    }
  });

  it("has six events and a few tasks that point at real assets", () => {
    expect(seed.events).toHaveLength(6);
    expect(seed.events.map((e) => e.ts.slice(0, 4)).sort()).toContain("2025");
    expect(seed.events.some((e) => e.assetId === "asset_dishwasher" && /install/i.test(e.summary))).toBe(true);
    expect(seed.events.filter((e) => /filter/i.test(e.summary)).length).toBeGreaterThanOrEqual(3);
    const ids = new Set(seed.assets.map((a) => a.assetId));
    for (const e of seed.events) if (e.assetId) expect(ids.has(e.assetId)).toBe(true);
    expect(seed.tasks.length).toBeGreaterThanOrEqual(3);
    for (const t of seed.tasks) if (t.assetId) expect(ids.has(t.assetId)).toBe(true);
  });

  it("keeps every user-facing string free of em dashes, en dashes and emoji", () => {
    expect(rawText).not.toMatch(/[\u2013\u2014\u{1F300}-\u{1FAFF}]/u);
  });

  it("makes the furnace filter 94 days old on the authored day", () => {
    const furnace = seed.assets.find((a) => a.assetId === "asset_furnace")!;
    expect(daysBetween(furnace.consumables[0]!.lastReplaced!, "2026-10-21")).toBe(94);
  });

  it("has no unresolved placeholder once the media base is applied", () => {
    expect(JSON.stringify(seed)).not.toContain("{{");
  });
});

describe("loadSeed", () => {
  const repos: Array<[string, () => HomeRepository]> = [
    ["MemoryRepo", () => new MemoryRepo(join(root, `m-${Math.random().toString(36).slice(2)}`, "g.json"))],
    ["DynamoRepo", () => new DynamoRepo("hearth-test", new FakeDoc("hearth-test", 3))],
  ];

  describe.each(repos)("into %s", (_name, make) => {
    it("loads the house and is idempotent", async () => {
      const repo = make();
      await loadSeed(repo, { now: NOW_AUTHORED });
      await loadSeed(repo, { now: NOW_AUTHORED });
      expect((await repo.getHomeForUser("usr_okafor"))?.name).toBe("The Okafor House");
      expect(await repo.listAssets("home_okafor")).toHaveLength(12);
      expect(await repo.listEvents("home_okafor")).toHaveLength(6);
      expect(await repo.listTasks("home_okafor")).toHaveLength(4);
      expect((await repo.getAsset("home_okafor", "asset_furnace"))?.consumables[0]?.lastReplaced).toBe("2026-07-19");
    });

    it("moves every date by the whole-day difference and stays one house when re-run on another day", async () => {
      const repo = make();
      await loadSeed(repo, { now: NOW_AUTHORED });
      const later = new Date("2026-10-31T18:00:00Z");
      await loadSeed(repo, { now: later });
      const furnace = (await repo.getAsset("home_okafor", "asset_furnace"))!;
      expect(furnace.consumables[0]?.lastReplaced).toBe("2026-07-29");
      expect(daysBetween(furnace.consumables[0]!.lastReplaced!, "2026-10-31")).toBe(94);
      expect(furnace.createdAt).toBe("2026-10-24T09:05:00-05:00");
      expect(furnace.installDate).toBe("2014-06-01");
      expect(await repo.listAssets("home_okafor")).toHaveLength(12);
      expect(await repo.listEvents("home_okafor")).toHaveLength(6);
      expect(await repo.listTasks("home_okafor")).toHaveLength(4);
      const tasks = await repo.listTasks("home_okafor");
      expect(tasks[0]).toMatchObject({ taskId: "task_furnace_filter", dueDate: "2026-10-27" });
      const events = await repo.listEvents("home_okafor", { assetId: "asset_furnace" });
      expect(events[0]?.ts).toBe("2026-07-29T09:15:00-05:00");
    });
  });
});

describe("buildSeed", () => {
  it("leaves the authored dates alone without `now`", () => {
    const seed = buildSeed();
    expect(seed.assets.find((a) => a.assetId === "asset_furnace")?.consumables[0]?.lastReplaced).toBe("2026-07-19");
    expect(seed.tasks.map((t) => t.dueDate)).toContain("2026-10-17");
  });

  it("resolves the media base and trims a trailing slash", () => {
    expect(buildSeed({ mcpBase: "https://demo.example.com/" }).assets[0]?.photos[0]?.url).toBe("https://demo.example.com/media/kitchen-ptrap.svg");
    expect(buildSeed().assets[0]?.photos[0]?.url).toBe(`${BASE}/media/kitchen-ptrap.svg`);
    expect(buildSeed({ mcpBase: "http://localhost:4200" }).home.homeId).toBe("home_okafor");
  });

  it("shifts backwards as well as forwards, keeping times and offsets", () => {
    const seed = buildSeed({ now: new Date("2026-10-11T18:00:00Z") });
    expect(seed.assets.find((a) => a.assetId === "asset_furnace")?.consumables[0]?.lastReplaced).toBe("2026-07-09");
    expect(seed.events.find((e) => e.eventId === "evt_furnace_filter_jul")?.ts).toBe("2026-07-09T09:15:00-05:00");
  });

  it("leaves non-date strings untouched when shifting", () => {
    const seed = buildSeed({ now: new Date("2027-01-10T18:00:00Z") });
    expect(seed.home.name).toBe("The Okafor House");
    expect(seed.assets[0]?.attributes).toEqual({ trapSize: "1-1/2", joint: "slip", material: "PVC" });
    expect(seed.assets.find((a) => a.assetId === "asset_furnace")?.attributes.merv).toBe(11);
  });

  it("works out the day in the home's time zone, not UTC", () => {
    // 02:00Z on the 22nd is still the evening of the 21st in Austin.
    expect(localDate(new Date("2026-10-22T02:00:00Z"), "America/Chicago")).toBe("2026-10-21");
    expect(dayShift(new Date("2026-10-22T02:00:00Z"), "America/Chicago")).toBe(0);
    expect(dayShift(new Date("2026-10-22T06:00:00Z"), "America/Chicago")).toBe(1);
    expect(dayShift(new Date("2026-10-21T12:00:00Z"), "America/Chicago")).toBe(0);
  });

  it("does calendar arithmetic across month and year ends", () => {
    expect(shiftDate("2026-10-21", 11)).toBe("2026-11-01");
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
  });
});
