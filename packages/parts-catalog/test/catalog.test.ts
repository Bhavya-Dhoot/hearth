import { CatalogItem, PART_MEDIA, RecallRecord } from "@hearth/contracts";
import { describe, expect, it } from "vitest";
import { playbooks } from "../../playbooks/src";
import { parts } from "../src";
import { parseCatalog, parseRecalls } from "../src/catalog";
import { assetById, seedAssets, seedTasks } from "./helpers";

const REAL_BRANDS = ["bosch", "whirlpool", "moen", "kohler", "delta", "carrier", "rheem", "lg", "insinkerator", "duracell", "energizer", "3m", "filtrete", "brita", "oatey", "fluidmaster", "korky", "danco", "kidde", "honeywell"];

describe("catalogue", () => {
  const catalog = parts.listCatalog();

  it("has about sixty valid, unique SKUs", () => {
    expect(catalog.length).toBeGreaterThanOrEqual(55);
    expect(catalog.length).toBeLessThanOrEqual(70);
    expect(new Set(catalog.map((i) => i.sku)).size).toBe(catalog.length);
    for (const item of catalog) expect(CatalogItem.safeParse(item).success, item.sku).toBe(true);
  });

  it("carries the hero washer exactly as specified", () => {
    expect(parts.getSku("HR-PT-150-WSH")).toMatchObject({
      sku: "HR-PT-150-WSH",
      price: 4.29,
      partRole: "ptrap_washer",
      fits: { trapSize: "1-1/2", joint: "slip" },
    });
    expect(parts.getSku("HR-PT-150-WSH")?.name).toMatch(/1-1\/2 inch slip-joint washer/i);
    expect(parts.getSku("NOPE")).toBeUndefined();
  });

  it("covers every part role any playbook uses, with at least three SKUs each", () => {
    const roles = new Set(playbooks.listPlaybooks().flatMap((p) => p.partRoles));
    expect(roles.size).toBeGreaterThanOrEqual(8);
    for (const role of roles) expect(catalog.filter((i) => i.partRole === role).length, role).toBeGreaterThanOrEqual(3);
    for (const role of ["fridge_filter", "disposal_gasket"]) expect(catalog.some((i) => i.partRole === role), role).toBe(true);
  });

  it("uses every part illustration and only known ones", () => {
    const used = new Set(catalog.map((i) => i.image));
    for (const file of PART_MEDIA) expect(used.has(file), file).toBe(true);
    for (const file of used) expect((PART_MEDIA as readonly string[]).includes(file), file).toBe(true);
  });

  it("prices to the cent and never uses a real brand", () => {
    for (const item of catalog) {
      expect(item.price).toBeGreaterThan(0);
      expect(Math.round(item.price * 100) / 100).toBe(item.price);
      expect(item.shipDays).toBeGreaterThanOrEqual(1);
      expect(REAL_BRANDS).not.toContain(item.brand.toLowerCase());
      expect(item.sku.startsWith("HR-")).toBe(true);
      expect(item.name).not.toMatch(/[\u2013\u2014\u{1F300}-\u{1FAFF}]/u);
    }
  });

  it("returns copies, not the internal array", () => {
    parts.listCatalog().pop();
    expect(parts.listCatalog()).toHaveLength(catalog.length);
  });

  it("stocks every SKU the seed home reorders", () => {
    const wanted = [
      ...seedAssets.flatMap((a) => a.consumables.map((c) => c.sku)),
      ...seedTasks.flatMap((t) => (t.reorderSku ? [t.reorderSku] : [])),
    ];
    expect(wanted.length).toBeGreaterThanOrEqual(4);
    for (const sku of wanted) expect(parts.getSku(sku), sku).toBeDefined();
  });
});

describe("recalls", () => {
  const recalls = parts.listRecalls();

  it("holds four labelled samples", () => {
    expect(recalls).toHaveLength(4);
    for (const r of recalls) {
      expect(RecallRecord.safeParse(r).success).toBe(true);
      expect(r.isSample).toBe(true);
      expect(r.title.startsWith("SAMPLE RECALL (demo data, not a real notice):")).toBe(true);
      expect(r.remedy.length).toBeGreaterThanOrEqual(2);
      expect(r.remedy.length).toBeLessThanOrEqual(4);
      expect(JSON.stringify(r)).not.toMatch(/[\u2013\u2014]/);
    }
  });

  it("matches the seed dishwasher and nothing else in the house", () => {
    const hits = recalls.flatMap((r) =>
      seedAssets
        .filter((a) => a.brand?.toLowerCase() === r.brand.toLowerCase() && a.model && new RegExp(r.modelPattern).test(a.model))
        .map((a) => `${a.assetId}:${r.recallId}`),
    );
    expect(hits).toEqual(["asset_dishwasher:SAMPLE-RC-DW-2026-001"]);
    expect(assetById("asset_dishwasher").recallIds).toEqual(["SAMPLE-RC-DW-2026-001"]);
  });

  it("returns copies", () => {
    parts.listRecalls().pop();
    expect(parts.listRecalls()).toHaveLength(4);
  });
});

describe("validation fails loudly", () => {
  const row = (extra: object = {}) => ({ sku: "HR-X-1", name: "Thing", partRole: "r", price: 1.5, image: "part-plunger.svg", fits: {}, brand: "Pinegate", shipDays: 1, ...extra });
  const recall = (extra: object = {}) => ({
    recallId: "SAMPLE-1",
    brand: "Acme",
    modelPattern: "^A$",
    title: "SAMPLE RECALL (demo data, not a real notice): x",
    hazard: "h",
    remedy: ["a"],
    isSample: true,
    ...extra,
  });

  it("rejects bad catalogue rows", () => {
    expect(() => parseCatalog([{ sku: "x" }])).toThrow();
    expect(() => parseCatalog([row(), row()])).toThrow(/Duplicate catalogue SKU/);
    expect(() => parseCatalog([row({ image: "nope.svg" })])).toThrow(/unknown part image/);
    expect(() => parseCatalog([row({ name: "Thing \u2014 big" })])).toThrow(/dash/);
    expect(parseCatalog([row()])).toHaveLength(1);
  });

  it("rejects bad recall rows", () => {
    expect(() => parseRecalls([recall(), recall()])).toThrow(/Duplicate recall/);
    expect(() => parseRecalls([recall({ modelPattern: "(" })])).toThrow();
    expect(() => parseRecalls([recall({ title: "Real looking notice" })])).toThrow(/not labelled as a sample/);
    expect(() => parseRecalls([recall({ hazard: "bad \u2013 dash" })])).toThrow(/dash/);
    expect(() => parseRecalls([recall({ isSample: false })])).toThrow();
    expect(parseRecalls([recall()])).toHaveLength(1);
  });
});
