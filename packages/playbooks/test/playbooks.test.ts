import { readFileSync } from "node:fs";
import { Playbook } from "@hearth/contracts";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { playbooks } from "../src";
import { PLAYBOOK_IDS, loadPlaybooks, parsePlaybook, validateRoutes } from "../src/loader";
import { exprWeight, matchesAny, normalise, routeKeyMatches, stripPhrases } from "../src/match";
import { renderTemplate } from "../src/template";
import { seedAssets } from "./helpers";

const DATA = new URL("../data/", import.meta.url);
const raw = (id: string): Record<string, unknown> => parseYaml(readFileSync(new URL(`${id}.yaml`, DATA), "utf8")) as Record<string, unknown>;

describe("playbook library", () => {
  it("ships the twelve Appendix D playbooks in order", () => {
    expect(playbooks.listPlaybooks().map((p) => p.id)).toEqual([...PLAYBOOK_IDS]);
    expect(PLAYBOOK_IDS).toHaveLength(12);
  });

  it("looks playbooks up by id", () => {
    expect(playbooks.getPlaybook("toilet-clog")?.title).toBe("Clogged toilet");
    expect(playbooks.getPlaybook("nope")).toBeUndefined();
  });

  it.each([...PLAYBOOK_IDS])("%s validates against the Playbook schema and house style", (id) => {
    const playbook = playbooks.getPlaybook(id)!;
    expect(Playbook.safeParse(playbook).success).toBe(true);
    expect(playbook.steps.length).toBeGreaterThanOrEqual(3);
    expect(playbook.questions.length).toBeLessThanOrEqual(2);
    expect(JSON.stringify(playbook)).not.toMatch(/[\u2013\u2014\u{1F300}-\u{1FAFF}]/u);
    for (const step of playbook.steps) {
      expect(step.instruction.endsWith(".")).toBe(true);
      if (step.photoOf) expect(step.addHint, `${id}: ${step.instruction}`).toBeTruthy();
    }
  });

  it("lists, for every part role a step needs, the same role on the playbook", () => {
    for (const playbook of playbooks.listPlaybooks()) {
      for (const step of playbook.steps) if (step.partRole) expect(playbook.partRoles).toContain(step.partRole);
    }
  });

  it("keeps the hero followUp and every other followUp pair complete", () => {
    for (const playbook of playbooks.listPlaybooks()) {
      expect(playbook.followUpDays === undefined).toBe(playbook.followUpTitle === undefined);
    }
  });

  it("gives the escalating playbooks a trade", () => {
    expect(playbooks.getPlaybook("breaker-tripped")?.trade).toBe("electrician");
    expect(playbooks.getPlaybook("ac-not-cooling")?.trade).toBe("hvac");
    expect(playbooks.getPlaybook("dishwasher-not-draining")?.trade).toBe("appliance");
  });
});

describe("loader failures are loud", () => {
  const base = (): Record<string, unknown> => structuredClone(raw("toilet-clog"));

  it("rejects a document that fails the schema", () => {
    expect(() => parsePlaybook({ id: "toilet-clog" }, "toilet-clog")).toThrow(/is invalid/);
  });

  it("rejects an id that does not match the file", () => {
    expect(() => parsePlaybook(base(), "toilet-running")).toThrow(/declares id/);
  });

  it("rejects a playbook without steps", () => {
    expect(() => parsePlaybook({ ...base(), steps: [] }, "toilet-clog")).toThrow(/no steps/);
  });

  it("rejects an em dash or an en dash", () => {
    const withDash = { ...base(), title: "Clogged \u2014 toilet" };
    expect(() => parsePlaybook(withDash, "toilet-clog")).toThrow(/dash/);
    expect(() => parsePlaybook({ ...base(), title: "Clogged \u2013 toilet" }, "toilet-clog")).toThrow(/dash/);
  });

  it("rejects an unknown placeholder and a placeholder without a fallback", () => {
    const step = (instruction: string) => ({ ...base(), steps: [{ instruction }] });
    expect(() => parsePlaybook(step("Fix {asset.colour|it}."), "toilet-clog")).toThrow(/unknown placeholder/);
    expect(() => parsePlaybook(step("Fix {asset.model}."), "toilet-clog")).toThrow(/no fallback/);
  });

  it("rejects an unknown fallback image and an unlisted part role", () => {
    expect(() => parsePlaybook({ ...base(), steps: [{ instruction: "Do it.", fallbackImage: "nope.svg" }] }, "toilet-clog")).toThrow(/fallbackImage/);
    expect(() => parsePlaybook({ ...base(), steps: [{ instruction: "Do it.", partRole: "mystery" }] }, "toilet-clog")).toThrow(/part role/);
  });

  it("rejects routes that point nowhere", () => {
    const clog = parsePlaybook(base(), "toilet-clog");
    const withRoute = (destination: string, extra: Partial<Playbook> = {}): Playbook => ({
      ...clog,
      ...extra,
      questions: [{ id: "q", text: "Q?", routes: { yes: destination } }, { id: "r", text: "R?", routes: { yes: "toilet-clog" } }],
    });
    expect(() => validateRoutes([withRoute("no-such-playbook")])).toThrow(/unknown playbook/);
    expect(() => validateRoutes([withRoute("hardstop:lava")])).toThrow(/safety category/);
    expect(() => validateRoutes([withRoute("escalate:   ")])).toThrow(/without a reason/);
    expect(() => validateRoutes([withRoute("question:missing")])).toThrow(/later question/);
    expect(() => validateRoutes([withRoute("question:q")])).toThrow(/later question/);
    expect(() => validateRoutes([withRoute("question:r")])).not.toThrow();
    expect(() => validateRoutes([withRoute("escalate:needs a pro")])).not.toThrow();
  });

  it("loads the real directory", () => {
    expect(loadPlaybooks(DATA)).toHaveLength(12);
  });
});

describe("matching grammar", () => {
  it("normalises case, apostrophes and punctuation", () => {
    expect(normalise("It's A/C -- won't COOL!")).toBe("its a c wont cool");
    expect(normalise("the hot water heater is cold")).toBe("the waterheater is cold");
  });

  it("matches at word starts and honours the whole-word marker", () => {
    expect(matchesAny("it is leaking", ["leak"])).toBe(true);
    expect(matchesAny("a gasket", ["gas$"])).toBe(false);
    expect(matchesAny("a gas leak", ["gas$"])).toBe(true);
    expect(matchesAny("sonic", ["son$"])).toBe(false);
  });

  it("requires every term of an & expression", () => {
    expect(matchesAny("outlet is hot", ["outlet&hot"])).toBe(true);
    expect(matchesAny("outlet is fine", ["outlet&hot"])).toBe(false);
    expect(exprWeight("a&b&c")).toBe(3);
  });

  it("expands concepts only when asked", () => {
    expect(matchesAny("water under the sink", ["leak"], true)).toBe(true);
    expect(matchesAny("water under the sink", ["leak"], false)).toBe(false);
  });

  it("matches route keys by alternatives", () => {
    expect(routeKeyMatches("the pipes", "dishwasher|pipe")).toBe(true);
    expect(routeKeyMatches("no", "no$|nope")).toBe(true);
    expect(routeKeyMatches("not really", "no$|nope")).toBe(false);
  });

  it("strips whole phrases and the rest of their word", () => {
    expect(stripPhrases("the child locks are stuck", ["child lock"])).toBe("the are stuck");
  });
});

describe("template rendering", () => {
  const disposal = seedAssets.find((a) => a.assetId === "asset_disposal")!;
  const scope = { asset: disposal, shutoff: undefined, year: 2026 };

  it("fills model, brand, name, label, age and sentence", () => {
    expect(renderTemplate("{asset.model|x} {asset.brand|x} {asset.label|x} {asset.ageYears|x}", scope)).toBe("Badger 5 InSinkErator garbage disposal 9");
    expect(renderTemplate("{asset.name|x}", scope)).toBe("InSinkErator Badger 5");
    expect(renderTemplate("{asset.ageSentence|}", scope)).toBe("Your InSinkErator Badger 5 is 9 years old.");
    expect(renderTemplate("{asset.location|x}", scope)).toBe("in your kitchen, under the sink");
  });

  it("uses singular for one year and the label when brand and model are missing", () => {
    const young = { ...disposal, installDate: "2025-01-01", brand: undefined, model: undefined };
    expect(renderTemplate("{asset.ageSentence|}", { ...scope, asset: young })).toBe("Your garbage disposal is 1 year old.");
  });

  it("falls back when a value is unknown", () => {
    const empty = { year: 2026 };
    expect(renderTemplate("{asset.model|disposal} {asset.name|unit} {asset.location|nearby} {asset.ageYears|old} {shutoff.location|here} {asset.label|thing} {asset.brand|maker}", empty)).toBe(
      "disposal unit nearby old here thing maker",
    );
    expect(renderTemplate("Replaced. {asset.ageSentence|} Done.", empty)).toBe("Replaced. Done.");
  });

  it("treats an install date in the future or in a bad format as unknown", () => {
    expect(renderTemplate("{asset.ageYears|n/a}", { ...scope, year: 2010 })).toBe("n/a");
    expect(renderTemplate("{asset.ageYears|n/a}", { ...scope, asset: { ...disposal, installDate: undefined } })).toBe("n/a");
  });

  it("leaves an unrecognised key to its fallback", () => {
    expect(renderTemplate("{nothing.here|ok}", scope)).toBe("ok");
  });

  it("describes a location by room alone when the note is long", () => {
    const panel = seedAssets.find((a) => a.assetId === "asset_panel")!;
    expect(renderTemplate("{shutoff.location|x}", { year: 2026, shutoff: panel })).toBe("in your garage");
  });
});
