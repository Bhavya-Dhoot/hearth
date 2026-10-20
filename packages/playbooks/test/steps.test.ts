import { GENERIC_MEDIA, HOME_MEDIA, RepairStepsOutput } from "@hearth/contracts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { playbooks } from "../src";
import { MCP_BASE, seedAssets } from "./helpers";

const ctx = { assets: seedAssets, mcpBase: MCP_BASE };
const bare = { assets: [], mcpBase: MCP_BASE };
const HERO = "leak-under-sink-ptrap";

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T12:00:00-05:00"));
});
afterAll(() => vi.useRealTimers());

describe("hero playbook", () => {
  const hero = playbooks.getPlaybook(HERO)!;

  it("has exactly six steps in the specified order", () => {
    expect(hero.steps).toHaveLength(6);
    expect(hero.steps[0]!.instruction).toMatch(/^Clear the cabinet/);
    expect(hero.steps[1]!.photoOf).toBe("sink_shutoff");
    expect(hero.steps[1]!.caution).toBeTruthy();
    expect(hero.steps[2]!.photoOf).toBe("ptrap");
    expect(hero.steps[3]).toMatchObject({ partRole: "ptrap_washer", partAssetCategory: "ptrap" });
    expect(hero.steps[4]!.tools?.length).toBeGreaterThan(0);
    expect(hero.steps[4]).toMatchObject({ partRole: "ptrap_washer", partAssetCategory: "ptrap" });
    expect(hero.steps[5]!.instruction).toMatch(/stays dry/);
    expect(hero.followUpDays).toBe(7);
    expect(hero.followUpTitle).toBe("Check under the kitchen sink is still dry");
    expect(hero.partRoles).toEqual(["ptrap_washer"]);
  });

  it("shows the customer's own shut-off photo on step 1 with a location chip", () => {
    const step = playbooks.getRepairStep(HERO, 1, ctx);
    expect(RepairStepsOutput.safeParse(step).success).toBe(true);
    expect(step).toMatchObject({
      issueId: HERO,
      stepIndex: 1,
      stepCount: 6,
      primaryAction: "next",
      isLast: false,
      canSkip: false,
      locationChip: "YOUR VALVE · UNDER SINK",
    });
    expect(step.image).toEqual({
      url: `${MCP_BASE}/media/kitchen-sink-shutoffs.svg`,
      alt: HOME_MEDIA["kitchen-sink-shutoffs.svg"].alt,
      isUsersPhoto: true,
      annotation: HOME_MEDIA["kitchen-sink-shutoffs.svg"].annotation,
    });
    expect(step.caution).toBeTruthy();
    expect(step.addHint).toBeUndefined();
    expect(step.detail).toContain("in your kitchen, under the sink");
  });

  it("falls back to the generic illustration and says how to add the valve", () => {
    const step = playbooks.getRepairStep(HERO, 1, bare);
    expect(step.image).toEqual({
      url: `${MCP_BASE}/media/generic-shutoff.svg`,
      alt: GENERIC_MEDIA["generic-shutoff.svg"],
      isUsersPhoto: false,
    });
    expect(step.locationChip).toBeUndefined();
    expect(step.addHint).toBe("Say 'add my shut-off valve' and I'll remember it.");
    expect(step.detail).toContain("under the sink");
  });

  it("names the part for the washer steps and resolves the asset", () => {
    expect(playbooks.getRepairStep(HERO, 3, ctx).partNeeded).toEqual({ partRole: "ptrap_washer", assetId: "asset_ptrap_kitchen" });
    expect(playbooks.getRepairStep(HERO, 4, ctx).tools).toContain("new slip-joint washer");
    expect(playbooks.getRepairStep(HERO, 3, bare).partNeeded).toBeUndefined();
  });

  it("marks the last step done and every earlier step next", () => {
    const last = playbooks.getRepairStep(HERO, 5, ctx);
    expect(last).toMatchObject({ isLast: true, primaryAction: "done" });
    for (let i = 0; i < 5; i++) expect(playbooks.getRepairStep(HERO, i, ctx)).toMatchObject({ isLast: false, primaryAction: "next" });
  });

  it("builds a valid step for every index", () => {
    for (let i = 0; i < 6; i++) expect(RepairStepsOutput.safeParse(playbooks.getRepairStep(HERO, i, ctx)).success).toBe(true);
  });
});

describe("getRepairStep errors", () => {
  it("throws RangeError past the end and below zero", () => {
    expect(() => playbooks.getRepairStep(HERO, 6, ctx)).toThrow(RangeError);
    expect(() => playbooks.getRepairStep(HERO, -1, ctx)).toThrow(RangeError);
    expect(() => playbooks.getRepairStep(HERO, 1.5, ctx)).toThrow(RangeError);
  });

  it("throws unknown_playbook for an unknown id", () => {
    expect(() => playbooks.getRepairStep("no-such-playbook", 0, ctx)).toThrow("unknown_playbook");
  });
});

describe("personalisation across playbooks", () => {
  it("uses the asset model in the disposal reset step", () => {
    expect(playbooks.getRepairStep("disposal-hum-jam", 1, ctx).instruction).toBe("Press the red reset button on the underside of your Badger 5.");
    expect(playbooks.getRepairStep("disposal-hum-jam", 1, bare).instruction).toBe("Press the red reset button on the underside of your disposal.");
  });

  it("shows no image when there is neither a photo nor a generic illustration", () => {
    const step = playbooks.getRepairStep("disposal-hum-jam", 1, bare);
    expect(step.image).toBeUndefined();
    expect(step.addHint).toBe("Say 'add my disposal' and I'll remember it.");
  });

  it("uses the panel photo and chip for the tripped breaker", () => {
    const step = playbooks.getRepairStep("breaker-tripped", 1, ctx);
    expect(step.locationChip).toBe("YOUR PANEL · GARAGE");
    expect(step.detail).toContain("Yours is in your garage.");
  });

  it("picks the room over a long note and the short note when it is brief", () => {
    const main = { ...seedAssets.find((a) => a.assetId === "asset_main_shutoff")!, category: "sink_shutoff" };
    const step = playbooks.getRepairStep(HERO, 1, { assets: [main], mcpBase: MCP_BASE });
    expect(step.locationChip).toBe("YOUR VALVE · GARAGE");
    expect(step.detail).toContain("in your garage, left of the panel");
  });

  it("names a part for the furnace filter step and tells the age of the furnace in escalations", () => {
    expect(playbooks.getRepairStep("furnace-not-heating", 2, ctx).partNeeded).toEqual({ partRole: "furnace_filter", assetId: "asset_furnace" });
    expect(playbooks.getRepairStep("furnace-not-heating", 2, ctx).instruction).toBe("Pull the filter from your 59SC2 and hold it up to a light.");
  });

  it("omits the model gracefully when the asset has none", () => {
    const furnace = { ...seedAssets.find((a) => a.assetId === "asset_furnace")!, model: undefined };
    expect(playbooks.getRepairStep("furnace-not-heating", 2, { assets: [furnace], mcpBase: MCP_BASE }).instruction).toBe(
      "Pull the filter from your furnace and hold it up to a light.",
    );
  });

  it("uses brand and model for the water heater and falls back without a photo", () => {
    expect(playbooks.getRepairStep("water-heater-no-hot", 0, ctx).instruction).toBe("Read the label on your Rheem XE50T10 and confirm it's electric.");
    expect(playbooks.getRepairStep("water-heater-no-hot", 0, bare).instruction).toBe("Read the label on your water heater and confirm it's electric.");
  });

  it("uses a generic toilet tank illustration when the home has no toilet", () => {
    const step = playbooks.getRepairStep("toilet-running", 0, ctx);
    expect(step.image?.url).toBe(`${MCP_BASE}/media/generic-toilet-tank.svg`);
    expect(step.image?.isUsersPhoto).toBe(false);
    expect(step.addHint).toBe("Say 'add my toilet' and I'll remember it.");
  });

  it("every step of every playbook builds against the seed home and an empty home", () => {
    for (const playbook of playbooks.listPlaybooks()) {
      for (let i = 0; i < playbook.steps.length; i++) {
        for (const home of [ctx, bare]) {
          const step = playbooks.getRepairStep(playbook.id, i, home);
          expect(RepairStepsOutput.safeParse(step).success, `${playbook.id} step ${i}`).toBe(true);
          expect(step.instruction).not.toMatch(/[{}]/);
          expect(step.detail ?? "").not.toMatch(/[{}]/);
        }
      }
    }
  });
});
