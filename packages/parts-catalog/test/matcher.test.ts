import { FindPartOutput } from "@hearth/contracts";
import type { Asset } from "@hearth/contracts";
import { describe, expect, it } from "vitest";
import { playbooks } from "../../playbooks/src";
import { parts } from "../src";
import { attributeLabel, describeValue, joinLabels, prettyInches, roleCopy } from "../src/format";
import { etaDate } from "../src/matcher";
import { MCP_BASE, NOW, assetById, seedAssets } from "./helpers";

const ctx = { mcpBase: MCP_BASE, now: NOW };

describe("exact fit for every playbook part role", () => {
  const unique = new Map<string, { playbook: string; role: string; category: string }>();
  for (const playbook of playbooks.listPlaybooks()) {
    for (const step of playbook.steps) {
      if (!step.partRole) continue;
      const category = step.partAssetCategory ?? playbook.assetCategory;
      unique.set(`${playbook.id}/${step.partRole}/${category}`, { playbook: playbook.id, role: step.partRole, category });
    }
  }
  const needs = [...unique.values()];

  it("finds the roles by reading the real playbooks", () => {
    expect(new Set(needs.map((n) => n.role)).size).toBeGreaterThanOrEqual(8);
  });

  it.each(needs)("$playbook / $role against the $category asset", ({ role, category }) => {
    const asset = seedAssets.find((a) => a.category === category);
    const out = parts.findExactParts({ partRole: role, ...(asset ? { asset } : {}) }, ctx);
    expect(FindPartOutput.safeParse(out).success).toBe(true);
    expect(out.items.length).toBeGreaterThanOrEqual(3);
    expect(out.items.length).toBeLessThanOrEqual(5);
    expect(out.selectedIndex).toBe(0);
    expect(out.partRole).toBe(role);
    if (asset) {
      expect(out.items[0]!.badge).toBe("EXACT FIT");
      expect(out.items[0]!.confidence).toBeGreaterThanOrEqual(0.9);
      expect(out.assetLabel).toBe(asset.label);
      expect(out.items[0]!.fitReason).toMatch(/^fits your /);
    } else {
      // The seed house has no toilet: the honest answer is COMPATIBLE, never EXACT FIT.
      expect(out.items.every((i) => i.badge === "COMPATIBLE")).toBe(true);
      expect(out.assetLabel).toBeUndefined();
      expect(out.items[0]!.fitReason).toContain("fits most homes");
    }
  });
});

describe("the hero part", () => {
  const out = parts.findExactParts({ partRole: "ptrap_washer", asset: assetById("asset_ptrap_kitchen") }, ctx);

  it("puts the 1-1/2 inch slip-joint washer first with the spec's fit reason", () => {
    expect(out.items[0]).toMatchObject({
      sku: "HR-PT-150-WSH",
      price: 4.29,
      currency: "USD",
      badge: "EXACT FIT",
      fitReason: "fits your 1½″ slip-joint P-trap, installed 2019",
      image: `${MCP_BASE}/media/part-slip-washer.svg`,
      etaDate: "2026-10-22",
    });
    expect(out.title).toBe("Slip-joint washers for your kitchen sink P-trap");
  });

  it("lists exact fits before compatible ones and never a wrong size", () => {
    const badges = out.items.map((i) => i.badge);
    expect(badges).toEqual([...badges].sort((a) => (a === "EXACT FIT" ? -1 : 1)));
    expect(out.items.map((i) => i.sku)).not.toContain("HR-PT-125-WSH");
    expect(out.items.some((i) => i.badge === "COMPATIBLE")).toBe(true);
    expect(out.items.filter((i) => i.badge === "EXACT FIT").length).toBeGreaterThanOrEqual(3);
  });

  it("scores exact fits at 0.9 or better and compatible ones lower", () => {
    for (const item of out.items) {
      if (item.badge === "EXACT FIT") expect(item.confidence).toBeGreaterThanOrEqual(0.9);
      else expect(item.confidence).toBeLessThan(0.9);
    }
    expect(out.items[0]!.confidence).toBeGreaterThan(out.items[1]!.confidence);
  });
});

describe("fit wording", () => {
  it("names the furnace filter by size and MERV and ranks MERV 8 as compatible", () => {
    const out = parts.findExactParts({ partRole: "furnace_filter", asset: assetById("asset_furnace") }, ctx);
    expect(out.items[0]!.fitReason).toBe("fits your 16×25×1 MERV 11 furnace filter slot, installed 2014");
    const compatible = out.items.find((i) => i.badge === "COMPATIBLE")!;
    expect(compatible.fitReason).toBe("works with your 16×25×1 furnace filter slot, installed 2014, but check the MERV rating before you order");
    expect(out.items.map((i) => i.sku)).not.toContain("HR-FF-202501-M11-2");
  });

  it("matches the fridge filter by model", () => {
    const out = parts.findExactParts({ partRole: "fridge_filter", asset: assetById("asset_fridge") }, ctx);
    expect(out.items[0]).toMatchObject({ sku: "HR-RF-UKF8001-1", badge: "EXACT FIT", fitReason: "fits your UKF8001 fridge water filter, installed 2019" });
    expect(out.items.map((i) => i.sku)).not.toContain("HR-RF-LT700-1");
  });

  it("matches supply lines to the 3/8 inch compression valves", () => {
    const out = parts.findExactParts({ partRole: "supply_line", asset: assetById("asset_sink_shutoffs") }, ctx);
    expect(out.items).toHaveLength(5);
    expect(out.items[0]!.fitReason).toBe("fits your 3/8 compression shut-off valves, installed 2019");
    expect(out.items.map((i) => i.sku)).not.toContain("HR-SL-20-IPS");
  });

  it("matches the disposal wrench socket and treats the universal key set as an exact fit", () => {
    const out = parts.findExactParts({ partRole: "disposal_hex_wrench", asset: assetById("asset_disposal") }, ctx);
    expect(out.items.map((i) => i.sku)).toEqual(["HR-DW-14-LHD", "HR-DW-14-THD", "HR-DW-SET"]);
    expect(out.items[0]!.fitReason).toBe("fits your ¼″ garbage disposal hex socket, installed 2017");
    expect(out.items[2]!.fitReason).toBe("fits your garbage disposal hex socket, installed 2017");
  });

  it("matches the 9V battery and thermostat battery to their assets", () => {
    expect(parts.findExactParts({ partRole: "9v_battery", asset: assetById("asset_smoke_detectors") }, ctx).items[0]!.badge).toBe("EXACT FIT");
    const thermostat = parts.findExactParts({ partRole: "thermostat_battery", asset: assetById("asset_furnace") }, ctx);
    expect(thermostat.items.map((i) => i.sku)).not.toContain("HR-BT-AAA-ALK8");
    expect(thermostat.items[0]!.fitReason).toContain("AA thermostat battery");
  });

  it("matches the dishwasher filter style", () => {
    const out = parts.findExactParts({ partRole: "dishwasher_filter", asset: assetById("asset_dishwasher") }, ctx);
    expect(out.items[0]!.fitReason).toBe("fits your cylinder-style dishwasher filter, installed 2021");
    expect(out.items.map((i) => i.sku)).not.toContain("HR-DF-FLAT-MESH");
  });

  it("omits the install year when the asset has none", () => {
    const out = parts.findExactParts({ partRole: "ptrap_washer", asset: { ...assetById("asset_ptrap_kitchen"), installDate: undefined } }, ctx);
    expect(out.items[0]!.fitReason).toBe("fits your 1½″ slip-joint P-trap");
  });
});

describe("a toilet the home does add", () => {
  const toilet: Asset = {
    ...assetById("asset_washer"),
    assetId: "asset_toilet",
    category: "toilet",
    label: "hall bath toilet",
    attributes: { flapperSize: "2" },
    installDate: "2015-04-01",
  };

  it("grades 2 inch flappers as exact and drops the 3 inch one", () => {
    const out = parts.findExactParts({ partRole: "toilet_flapper", asset: toilet }, ctx);
    expect(out.items.every((i) => i.badge === "EXACT FIT")).toBe(true);
    expect(out.items.map((i) => i.sku)).not.toContain("HR-TF-3-UNI");
    expect(out.items[0]!.fitReason).toBe("fits your 2″ toilet flapper, installed 2015");
  });

  it("treats universal fill valves and plungers as exact for any toilet", () => {
    expect(parts.findExactParts({ partRole: "toilet_fill_valve", asset: toilet }, ctx).items.every((i) => i.badge === "EXACT FIT")).toBe(true);
    const plunger = parts.findExactParts({ partRole: "plunger", asset: toilet }, ctx);
    expect(plunger.items.map((i) => i.sku)).toEqual(["HR-PL-FLG-STD", "HR-PL-FLG-HLD", "HR-PL-FLG-BEE"]);
  });
});

describe("when nothing fits exactly", () => {
  it("tops up with honestly labelled closest matches", () => {
    const wrongTrap: Asset = { ...assetById("asset_ptrap_kitchen"), attributes: { trapSize: "2", joint: "slip" } };
    const out = parts.findExactParts({ partRole: "ptrap_washer", asset: wrongTrap }, ctx);
    expect(out.items.length).toBeGreaterThanOrEqual(3);
    expect(out.items[0]).toMatchObject({ sku: "HR-PT-ASST", badge: "COMPATIBLE" });
    const closest = out.items.slice(1);
    expect(closest.every((i) => i.badge === "COMPATIBLE" && i.confidence <= 0.5)).toBe(true);
    expect(closest[0]!.fitReason).toBe("closest match for a P-trap, so confirm the trap size on your kitchen sink P-trap before you order");
  });

  it("lists a missing attribute as something to check", () => {
    const bare: Asset = { ...assetById("asset_ptrap_kitchen"), attributes: {} };
    const out = parts.findExactParts({ partRole: "ptrap_washer", asset: bare }, ctx);
    expect(out.items[0]!.fitReason).toContain("trap size and joint type");
  });

  it("answers without an asset using the role heading only", () => {
    const out = parts.findExactParts({ partRole: "furnace_filter" }, ctx);
    expect(out.title).toBe("Furnace filters");
    expect(out.items.every((i) => i.badge === "COMPATIBLE" && i.confidence === 0.6)).toBe(true);
    expect(out.items[0]!.fitReason).toBe("fits most homes. Say 'add my furnace filter slot' and I'll match it exactly.");
  });

  it("throws no_parts for a role the catalogue does not stock", () => {
    expect(() => parts.findExactParts({ partRole: "garage_door_spring" }, ctx)).toThrow("no_parts");
  });
});

describe("delivery dates", () => {
  it("adds ship days to the date in UTC", () => {
    expect(etaDate(new Date("2026-10-21T17:00:00Z"), 1)).toBe("2026-10-22");
    expect(etaDate(new Date("2026-10-21T17:00:00Z"), 0)).toBe("2026-10-21");
  });

  it("skips Sundays", () => {
    expect(etaDate(new Date("2026-10-24T15:00:00Z"), 1)).toBe("2026-10-26"); // Saturday + 1 = Monday
    expect(etaDate(new Date("2026-10-23T15:00:00Z"), 2)).toBe("2026-10-26"); // Friday + 2 = Monday
    expect(etaDate(new Date("2026-10-25T15:00:00Z"), 1)).toBe("2026-10-26"); // Sunday + 1 = Monday
    expect(etaDate(new Date("2026-10-23T15:00:00Z"), 8)).toBe("2026-11-02"); // Friday + 8 shipping days
  });

  it("never lands on a Sunday for any start and ship time", () => {
    for (let start = 0; start < 14; start++) {
      for (let ship = 1; ship <= 5; ship++) {
        const eta = new Date(`${etaDate(new Date(Date.UTC(2026, 9, 18 + start)), ship)}T00:00:00Z`);
        expect(eta.getUTCDay()).not.toBe(0);
      }
    }
  });

  it("uses each item's own ship time", () => {
    const out = parts.findExactParts({ partRole: "ptrap_washer", asset: assetById("asset_ptrap_kitchen") }, ctx);
    expect(out.items.map((i) => i.etaDate)).toEqual(out.items.map((i) => etaDate(NOW, parts.getSku(i.sku)!.shipDays)));
  });
});

describe("wording helpers", () => {
  it("formats inch sizes", () => {
    expect(prettyInches("1-1/2")).toBe("1½″");
    expect(prettyInches("3/8")).toBe("⅜″");
    expect(prettyInches("2")).toBe("2″");
    expect(prettyInches("5/16")).toBe("5/16″");
    expect(prettyInches("1-5/16")).toBe("1 5/16″");
  });

  it("describes attribute values", () => {
    expect(describeValue("joint", "slip")).toBe("slip-joint");
    expect(describeValue("filterSize", "16x25x1")).toBe("16×25×1");
    expect(describeValue("merv", 11)).toBe("MERV 11");
    expect(describeValue("filterStyle", "cylinder")).toBe("cylinder-style");
    expect(describeValue("mount", "3-bolt")).toBe("3-bolt mount");
    expect(describeValue("batteryType", "9V")).toBe("9V");
    expect(describeValue("labelled", true)).toBe("true");
  });

  it("labels attributes and joins them", () => {
    expect(attributeLabel("merv")).toBe("MERV rating");
    expect(attributeLabel("somethingNew")).toBe("somethingNew");
    expect(joinLabels([])).toBe("");
    expect(joinLabels(["a"])).toBe("a");
    expect(joinLabels(["a", "b"])).toBe("a and b");
    expect(joinLabels(["a", "b", "c"])).toBe("a, b and c");
  });

  it("falls back to the role name for an unknown role", () => {
    expect(roleCopy("garage_door_spring")).toEqual({ title: "garage door spring", noun: "garage door spring" });
  });
});
