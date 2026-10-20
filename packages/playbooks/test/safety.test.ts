import { SafetyCategory } from "@hearth/contracts";
import { describe, expect, it } from "vitest";
import { playbooks, SAFETY_MESSAGES } from "../src";

interface StopCase {
  text: string;
  category?: SafetyCategory;
}

const HARD_STOPS: StopCase[] = [
  { text: "I smell gas near the stove", category: "gas" },
  { text: "It smells like rotten eggs in the kitchen", category: "gas" },
  { text: "There's a gas smell coming from the furnace closet", category: "gas" },
  { text: "The pilot light on my water heater went out", category: "gas" },
  { text: "The carbon monoxide alarm is going off", category: "gas" },
  { text: "The breaker keeps tripping every time I run the microwave", category: "electrical" },
  { text: "There are sparks coming out of the bedroom outlet", category: "electrical" },
  { text: "I want to replace a breaker in the panel myself", category: "electrical" },
  { text: "There's a burning smell from the outlet behind the couch", category: "electrical" },
  { text: "I took the panel cover off to look inside", category: "electrical" },
  { text: "The ceiling is sagging and there's a crack in the foundation", category: "structural" },
  { text: "Can I cut into a load-bearing wall to move the sink?", category: "structural" },
  { text: "A pipe burst in the basement and water is everywhere", category: "flooding" },
  { text: "The shut-off valve won't turn and water keeps pouring out", category: "flooding" },
  { text: "Sewage is coming up in the shower and the toilet", category: "sewage" },
  { text: "All the drains in the house are backing up", category: "sewage" },
  { text: "My 9 year old son wants to fix the leak under the sink" },
  { text: "My daughter's name is Ada and she is 7" },
  { text: "Can my kid help me tighten the nut?" },
];

describe("checkHardStop", () => {
  it.each(HARD_STOPS)("stops: $text", ({ text, category }) => {
    const result = playbooks.checkHardStop(text);
    expect(result.hardStop).toBe(true);
    expect(result.category).toBe(category);
    expect(result.message).toBe(SAFETY_MESSAGES[category ?? "minors"]);
  });

  it("covers every safety category and the minors policy at least once", () => {
    const seen = new Set<string>(HARD_STOPS.map((c) => c.category ?? "minors"));
    for (const category of [...SafetyCategory.options, "minors"]) expect(seen.has(category), category).toBe(true);
    expect(HARD_STOPS.length).toBeGreaterThanOrEqual(8);
  });

  it("uses the exact gas message from the product voice guide", () => {
    expect(SAFETY_MESSAGES.gas).toBe("Stop. If you smell gas, leave the house now and call your gas company from outside. I won't give steps for this.");
  });

  it("gives the minors rule no category and says Hearth is for adults", () => {
    const result = playbooks.checkHardStop("my toddler pulled the trap off");
    expect(result.hardStop).toBe(true);
    expect(result.category).toBeUndefined();
    expect(result.message).toContain("Hearth is for adults");
    expect(result.message).toContain("won't store any details about children");
  });

  it("puts gas ahead of every other category when several match", () => {
    expect(playbooks.checkHardStop("sparks from the outlet and I smell gas").category).toBe("gas");
  });

  it.each([
    "there's water under the kitchen sink",
    "I have a minor leak under the sink",
    "the child lock on my dishwasher is stuck",
    "the disposal is 9 years old and humming",
    "the toilet keeps running",
    "my smoke detector keeps chirping",
    "the shower drain is slow",
  ])("lets an ordinary report through: %s", (text) => {
    expect(playbooks.checkHardStop(text)).toEqual({ hardStop: false });
  });

  it("keeps every message free of em dashes, en dashes and emoji", () => {
    for (const message of Object.values(SAFETY_MESSAGES)) {
      expect(message).not.toMatch(/[\u2013\u2014\u{1F300}-\u{1FAFF}]/u);
    }
  });
});
