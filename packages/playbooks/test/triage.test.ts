import { TriageOutput, type Playbook } from "@hearth/contracts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { playbooks, SAFETY_MESSAGES } from "../src";
import { createTriage } from "../src/triage";
import { seedAssets } from "./helpers";

interface Case {
  name: string;
  symptomText: string;
  answers?: Record<string, string>;
  expect: {
    issueId?: string | null;
    escalate?: boolean;
    hardStop?: boolean;
    category?: string;
    question?: string;
    trade?: string;
    reasonIncludes?: string[];
  };
}

const sinkWater = "there's water under the kitchen sink";

const CASES: Case[] = [
  // Appendix G sequence
  { name: "G1 opens with the source question", symptomText: sinkWater, expect: { issueId: null, question: "source", escalate: false, hardStop: false } },
  { name: "G2 pipes routes to the P-trap", symptomText: sinkWater, answers: { source: "pipes" }, expect: { issueId: "leak-under-sink-ptrap", escalate: false, hardStop: false } },
  { name: "G3 dishwasher side routes to the supply line", symptomText: sinkWater, answers: { source: "dishwasher side" }, expect: { issueId: "leak-under-sink-supply-line", escalate: false } },
  { name: "G4 the disposal itself escalates", symptomText: "Actually, it's coming from the disposal unit itself", expect: { issueId: "disposal-leak-body", escalate: true, trade: "plumber", reasonIncludes: ["internal seal", "9 years old"] } },
  { name: "G4b disposal text wins over an older answer", symptomText: "Actually, it's coming from the disposal unit itself", answers: { source: "pipes" }, expect: { issueId: "disposal-leak-body", escalate: true } },
  { name: "G4c disposal given as the answer", symptomText: sinkWater, answers: { source: "Actually, it's coming from the disposal unit itself" }, expect: { issueId: "disposal-leak-body", escalate: true, reasonIncludes: ["internal seal"] } },
  // leak cluster
  { name: "kitchen sink leaking is ambiguous", symptomText: "my kitchen sink is leaking", expect: { issueId: null, question: "source" } },
  { name: "p-trap named outright", symptomText: "the p-trap under my sink is dripping", expect: { issueId: "leak-under-sink-ptrap", escalate: false } },
  { name: "leak persists after a new washer", symptomText: "I replaced the washer on the p-trap and it is still dripping", expect: { issueId: "leak-under-sink-ptrap", escalate: true, trade: "plumber", reasonIncludes: ["plumber"] } },
  { name: "braided hose leaking", symptomText: "the braided hose under the sink is leaking", expect: { issueId: "leak-under-sink-supply-line", escalate: false } },
  { name: "dishwasher leaking goes to the supply line", symptomText: "my dishwasher is leaking onto the floor", expect: { issueId: "leak-under-sink-supply-line" } },
  { name: "answer that matches no route asks again", symptomText: sinkWater, answers: { source: "no idea" }, expect: { issueId: null, question: "source" } },
  // disposal
  { name: "disposal humming", symptomText: "my garbage disposal is humming but won't spin", expect: { issueId: "disposal-hum-jam", escalate: false } },
  { name: "disposal jammed", symptomText: "the disposal is jammed", expect: { issueId: "disposal-hum-jam" } },
  { name: "disposal won't turn on", symptomText: "the garbage disposal won't turn on at all", expect: { issueId: "disposal-hum-jam" } },
  { name: "disposal burning smell escalates", symptomText: "the disposal is humming and there is a burning smell from the motor", expect: { issueId: "disposal-hum-jam", escalate: true, reasonIncludes: ["overheated"] } },
  { name: "disposal still hums after reset escalates", symptomText: "the disposal still hums after I pressed reset", expect: { issueId: "disposal-hum-jam", escalate: true } },
  { name: "disposal leaking from the bottom", symptomText: "the garbage disposal is leaking from the bottom", expect: { issueId: "disposal-leak-body", escalate: true, trade: "plumber" } },
  // toilets
  { name: "toilet keeps running", symptomText: "the toilet keeps running", expect: { issueId: "toilet-running", escalate: false } },
  { name: "phantom flush", symptomText: "my toilet does a phantom flush in the night", expect: { issueId: "toilet-running" } },
  { name: "toilet won't flush", symptomText: "my toilet won't flush and the bowl is filling up", expect: { issueId: "toilet-clog", escalate: false } },
  { name: "toilet clogged with a toy escalates", symptomText: "the toilet is clogged and a toy went down it", expect: { issueId: "toilet-clog", escalate: true } },
  { name: "vague toilet asks the kind question", symptomText: "something is wrong with the toilet", expect: { issueId: null, question: "kind" } },
  { name: "kind running", symptomText: "something is wrong with the toilet", answers: { kind: "running" }, expect: { issueId: "toilet-running" } },
  { name: "kind clogged leads to the scope question", symptomText: "something is wrong with the toilet", answers: { kind: "clogged" }, expect: { issueId: null, question: "scope" } },
  { name: "scope just this toilet", symptomText: "something is wrong with the toilet", answers: { kind: "clogged", scope: "just this toilet" }, expect: { issueId: "toilet-clog", escalate: false } },
  { name: "scope no", symptomText: "something is wrong with the toilet", answers: { kind: "clogged", scope: "no" }, expect: { issueId: "toilet-clog" } },
  { name: "scope other drains hard-stops for sewage", symptomText: "something is wrong with the toilet", answers: { kind: "clogged", scope: "yes the tub gurgles too" }, expect: { hardStop: true, category: "sewage", issueId: null, escalate: true, trade: "plumber" } },
  { name: "scope unrecognised asks again", symptomText: "something is wrong with the toilet", answers: { kind: "clogged", scope: "hmm" }, expect: { question: "scope" } },
  // electrical
  { name: "kitchen breaker tripped", symptomText: "the breaker for the kitchen tripped", expect: { issueId: "breaker-tripped", escalate: false } },
  { name: "half the kitchen lost power", symptomText: "half of the kitchen lost power", expect: { issueId: "breaker-tripped" } },
  { name: "dead garage outlet", symptomText: "the outlet in the garage is dead", expect: { issueId: "breaker-tripped" } },
  { name: "breaker trips daily escalates", symptomText: "the breaker trips every day when we use the toaster", expect: { issueId: "breaker-tripped", escalate: true, trade: "electrician" } },
  // HVAC
  { name: "AC blowing warm air", symptomText: "my AC is blowing warm air", expect: { issueId: "ac-not-cooling", escalate: false } },
  { name: "house won't cool", symptomText: "the house won't cool down", expect: { issueId: "ac-not-cooling" } },
  { name: "AC frozen escalates", symptomText: "the air conditioner is frozen with ice on the lines", expect: { issueId: "ac-not-cooling", escalate: true, trade: "hvac", reasonIncludes: ["refrigerant"] } },
  { name: "no heat", symptomText: "there's no heat in the house", expect: { issueId: "furnace-not-heating", escalate: false } },
  { name: "furnace won't start", symptomText: "the furnace won't turn on", expect: { issueId: "furnace-not-heating" } },
  { name: "too cold upstairs", symptomText: "it's too cold upstairs", expect: { issueId: "furnace-not-heating" } },
  { name: "furnace clicking escalates", symptomText: "the furnace is clicking and won't ignite", expect: { issueId: "furnace-not-heating", escalate: true, trade: "hvac" } },
  { name: "temperature wrong asks heating or cooling", symptomText: "the temperature in the house is wrong", expect: { issueId: null, question: "mode" } },
  { name: "mode heating", symptomText: "the temperature in the house is wrong", answers: { mode: "heating" }, expect: { issueId: "furnace-not-heating" } },
  { name: "mode cooling", symptomText: "the temperature in the house is wrong", answers: { mode: "cooling" }, expect: { issueId: "ac-not-cooling" } },
  // water heater, dishwasher, smoke detector
  { name: "no hot water", symptomText: "we have no hot water", expect: { issueId: "water-heater-no-hot", escalate: false } },
  { name: "water heater leaking escalates with its age", symptomText: "the water heater is leaking at the bottom", expect: { issueId: "water-heater-no-hot", escalate: true, reasonIncludes: ["8 years old"] } },
  { name: "dishwasher won't drain", symptomText: "the dishwasher won't drain and has standing water", expect: { issueId: "dishwasher-not-draining", escalate: false } },
  { name: "dishwasher full of water", symptomText: "my dishwasher is full of water after the cycle", expect: { issueId: "dishwasher-not-draining" } },
  { name: "smoke detector chirping", symptomText: "the smoke detector is chirping", expect: { issueId: "smoke-detector-chirp", escalate: false } },
  { name: "smoke alarm beeping at night", symptomText: "a smoke alarm beeps every minute in the middle of the night", expect: { issueId: "smoke-detector-chirp" } },
  { name: "chirp with a new battery escalates", symptomText: "the smoke detector still chirps with a new battery", expect: { issueId: "smoke-detector-chirp", escalate: true } },
  // no match
  { name: "unmatched asks to describe", symptomText: "I hear a weird noise", expect: { issueId: null, question: "describe" } },
  { name: "describe answer finds a playbook", symptomText: "I hear a weird noise", answers: { describe: "the furnace is not heating" }, expect: { issueId: "furnace-not-heating" } },
  { name: "describe answer that still matches nothing escalates", symptomText: "I hear a weird noise", answers: { describe: "banana" }, expect: { issueId: null, escalate: true, trade: "general", hardStop: false } },
  // hard stops through triage
  { name: "gas smell", symptomText: "I smell gas near the furnace", expect: { hardStop: true, category: "gas", issueId: null, escalate: true, trade: "gas_utility" } },
  { name: "sparking outlet", symptomText: "the outlet is sparking when I plug in the kettle", expect: { hardStop: true, category: "electrical", trade: "electrician" } },
  { name: "ceiling sagging", symptomText: "the ceiling below the bathroom is sagging", expect: { hardStop: true, category: "structural", trade: "general" } },
  { name: "burst pipe", symptomText: "a pipe burst under the house", expect: { hardStop: true, category: "flooding", trade: "plumber" } },
  { name: "sewage in the tub", symptomText: "sewage is coming up in the tub", expect: { hardStop: true, category: "sewage" } },
  { name: "child doing the repair", symptomText: "my 10 year old son is going to fix the dripping trap", expect: { hardStop: true, issueId: null, escalate: true, trade: "general" } },
  { name: "hard stop inside an answer", symptomText: sinkWater, answers: { source: "it smells like gas too" }, expect: { hardStop: true, category: "gas" } },
];

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T12:00:00-05:00"));
});
afterAll(() => vi.useRealTimers());

describe("triage", () => {
  it("has at least 40 table-driven utterances including 8 hard stops", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(40);
    expect(CASES.filter((c) => c.expect.hardStop).length).toBeGreaterThanOrEqual(8);
  });

  it.each(CASES)("$name", ({ symptomText, answers, expect: want }) => {
    const out = playbooks.triage({ symptomText, ...(answers ? { answers } : {}) }, { assets: seedAssets });
    expect(TriageOutput.safeParse(out).success).toBe(true);
    if (want.issueId !== undefined) expect(out.issueId).toBe(want.issueId);
    if (want.escalate !== undefined) expect(out.escalate).toBe(want.escalate);
    if (want.hardStop !== undefined) expect(out.safety.hardStop).toBe(want.hardStop);
    if (want.category !== undefined) expect(out.safety.category).toBe(want.category);
    if (want.trade !== undefined) expect(out.trade).toBe(want.trade);
    if (want.question !== undefined) {
      expect(out.clarifyingQuestions).toHaveLength(1);
      expect(out.clarifyingQuestions[0]?.id).toBe(want.question);
    }
    for (const fragment of want.reasonIncludes ?? []) expect(out.escalateReason?.toLowerCase()).toContain(fragment.toLowerCase());
    if (out.safety.hardStop) {
      expect(out.issueId).toBeNull();
      expect(out.clarifyingQuestions).toEqual([]);
      expect(out.escalate).toBe(true);
      expect(out.trade).toBeDefined();
      expect(out.safety.message).toBeTruthy();
    } else {
      expect(out.safety.message).toBeUndefined();
    }
  });

  it("every playbook is reachable from some utterance", () => {
    const reached = new Set(CASES.map((c) => c.expect.issueId).filter((id): id is string => typeof id === "string"));
    for (const playbook of playbooks.listPlaybooks()) expect(reached.has(playbook.id), playbook.id).toBe(true);
  });

  it("never asks more than two questions across a whole dialogue", () => {
    const asked = new Set<string>();
    let answers: Record<string, string> = {};
    const replies: Record<string, string> = { kind: "clogged", scope: "no" };
    for (let turn = 0; turn < 5; turn++) {
      const out = playbooks.triage({ symptomText: "something is wrong with the toilet", answers }, { assets: seedAssets });
      const next = out.clarifyingQuestions[0];
      if (!next) break;
      asked.add(next.id);
      answers = { ...answers, [next.id]: replies[next.id]! };
    }
    expect(asked.size).toBeLessThanOrEqual(2);
  });
});

describe("Appendix G exact outputs", () => {
  it("returns the source question verbatim", () => {
    const out = playbooks.triage({ symptomText: "there's water under the kitchen sink" }, { assets: seedAssets });
    expect(out.issueId).toBeNull();
    expect(out.clarifyingQuestions).toEqual([
      { id: "source", text: "Is it dripping from the pipes, or pooling from the dishwasher side?", options: ["pipes", "dishwasher side"] },
    ]);
    expect(out.escalate).toBe(false);
  });

  it("resolves pipes to the hero playbook at confidence 0.86", () => {
    const out = playbooks.triage({ symptomText: "there's water under the kitchen sink", answers: { source: "pipes" } }, { assets: seedAssets });
    expect(out).toMatchObject({
      issueId: "leak-under-sink-ptrap",
      confidence: 0.86,
      safety: { hardStop: false },
      escalate: false,
      clarifyingQuestions: [],
      suspectedAsset: { assetId: "asset_ptrap_kitchen", label: "kitchen sink P-trap" },
    });
  });

  it("names the seed disposal as nine years old in 2026", () => {
    const out = playbooks.triage({ symptomText: "Actually, it's coming from the disposal unit itself" }, { assets: seedAssets });
    expect(out.escalateReason).toMatch(/internal seal/i);
    expect(out.escalateReason).toContain("InSinkErator Badger 5 is 9 years old");
    expect(out.suspectedAsset).toEqual({ assetId: "asset_disposal", label: "garbage disposal" });
  });
});

describe("triage details", () => {
  it("leaves suspectedAsset out when the home has no such asset", () => {
    const out = playbooks.triage({ symptomText: "the toilet keeps running" }, { assets: seedAssets });
    expect(out.issueId).toBe("toilet-running");
    expect(out.suspectedAsset).toBeUndefined();
  });

  it("prefers a suspectedAssetId the home actually has", () => {
    const out = playbooks.triage({ symptomText: "the p-trap under my sink is dripping", suspectedAssetId: "asset_sink_shutoffs" }, { assets: seedAssets });
    expect(out.suspectedAsset?.assetId).toBe("asset_sink_shutoffs");
  });

  it("ignores a suspectedAssetId the home does not have", () => {
    const out = playbooks.triage({ symptomText: "the p-trap under my sink is dripping", suspectedAssetId: "asset_missing" }, { assets: seedAssets });
    expect(out.suspectedAsset?.assetId).toBe("asset_ptrap_kitchen");
  });

  it("writes the escalation reason without an age when the home has no install date", () => {
    const assets = seedAssets.map((a) => (a.assetId === "asset_disposal" ? { ...a, installDate: undefined } : a));
    const out = playbooks.triage({ symptomText: "the garbage disposal is leaking from the bottom" }, { assets });
    expect(out.escalateReason?.toLowerCase()).toContain("internal seal");
    expect(out.escalateReason).not.toContain("years old");
  });

  it("is deterministic", () => {
    const input = { symptomText: "there's water under the kitchen sink", answers: { source: "pipes" } };
    expect(playbooks.triage(input, { assets: seedAssets })).toEqual(playbooks.triage(input, { assets: seedAssets }));
  });

  it("applies a playbook's own hard stops when the global rules stay quiet", () => {
    expect(playbooks.checkHardStop("my toilet is clogged and the shower is gurgling").hardStop).toBe(false);
    const out = playbooks.triage({ symptomText: "my toilet is clogged and the shower is gurgling" }, { assets: seedAssets });
    expect(out.issueId).toBeNull();
    expect(out.safety).toMatchObject({ hardStop: true, category: "sewage", message: SAFETY_MESSAGES.sewage });
  });
});

describe("escalate: routes", () => {
  it("escalate the asking playbook with a rendered reason", () => {
    const source = playbooks.getPlaybook("disposal-hum-jam")!;
    const synthetic: Playbook = {
      ...source,
      questions: [{ id: "smell", text: "Do you notice a smell?", options: ["yes", "no"], routes: { "yes": "escalate:Smell from your {asset.name|disposal}. {asset.ageSentence|}", "no": "disposal-hum-jam" } }],
      symptoms: ["disposal"],
    };
    const other: Playbook = { ...source, id: "other", symptoms: ["disposal"], questions: [] };
    const engine = createTriage([synthetic, other]);
    const ask = engine.triage({ symptomText: "disposal" }, { assets: seedAssets });
    expect(ask.clarifyingQuestions[0]?.id).toBe("smell");
    const out = engine.triage({ symptomText: "disposal", answers: { smell: "yes" } }, { assets: seedAssets });
    expect(out).toMatchObject({
      issueId: "disposal-hum-jam",
      escalate: true,
      trade: "plumber",
      escalateReason: "Smell from your InSinkErator Badger 5. Your InSinkErator Badger 5 is 9 years old.",
      suspectedAsset: { assetId: "asset_disposal" },
    });
  });

  it("settles for the leading playbook when a tie has no question to ask", () => {
    const source = playbooks.getPlaybook("disposal-hum-jam")!;
    const a: Playbook = { ...source, id: "a", symptoms: ["disposal"], questions: [] };
    const b: Playbook = { ...source, id: "b", symptoms: ["disposal"], questions: [] };
    const out = createTriage([a, b]).triage({ symptomText: "disposal" }, { assets: seedAssets });
    expect(out).toMatchObject({ issueId: "a", confidence: 0.55 });
  });
});
