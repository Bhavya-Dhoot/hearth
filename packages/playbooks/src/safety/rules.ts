import type { SafetyCategory, TriageOutput } from "@hearth/contracts";
import { matchesAnyNormalised, normalise, stripPhrases } from "../match";

/**
 * Deterministic hard-stop rules (PRD 7.4, Appendix D). Keywords are literal (no synonym
 * expansion) and use the match.ts grammar: "a&b" needs both terms, a trailing "$" needs a whole
 * word. The rules lean toward stopping: a false stop costs one phone call to a pro, a missed one
 * costs far more.
 */

export type Trade = NonNullable<TriageOutput["trade"]>;

export interface HardStopRule {
  /** Null marks the policy rule for children, which has no SafetyCategory. */
  readonly category: SafetyCategory | null;
  readonly keywords: readonly string[];
}

/** Evaluated in order, so gas wins over everything else when several rules match. */
export const HARD_STOP_RULES: readonly HardStopRule[] = [
  {
    category: "gas",
    keywords: [
      "smell gas", "smells gas", "smell of gas", "smells like gas", "gas smell", "gas odor", "gas odour",
      "gas&smell", "gas&odor", "gas&hiss", "gas leak", "leaking gas", "rotten egg", "sulfur", "sulphur",
      "gas line", "gas pipe", "gas main", "natural gas", "propane&smell", "propane&leak",
      "carbon monoxide", "co alarm", "co detector", "pilot light", "pilot&out", "relight",
    ],
  },
  {
    category: "electrical",
    keywords: [
      "spark", "arcing", "outlet&burn", "outlet&smoke", "outlet&melt", "outlet&hot", "outlet&scorch", "outlet&smell",
      "switch&burn", "switch&smoke", "panel&burn", "panel&smoke", "panel&hot", "panel&buzz", "panel&hum",
      "breaker&burn", "breaker&smoke", "breaker&hot", "breaker&buzz", "wire&burn", "wire&smoke", "cord&burn", "cord&melt",
      "trips again", "tripped again", "tripping again", "trip again", "keeps tripping", "keeps on tripping",
      "trips immediately", "trips right away", "trips as soon", "breaker&wont reset", "breaker&wont stay",
      "gfci&wont reset", "wont stay reset", "panel cover", "open the panel", "open the electrical panel",
      "open up the panel", "inside the panel", "inside the electrical panel", "inside the breaker box",
      "breaker box cover", "dead front", "deadfront", "replace&breaker", "swap&breaker", "change&breaker",
      "install&breaker", "new breaker", "add a breaker", "add&circuit", "new circuit", "rewire", "rewiring",
      "bus bar", "busbar", "service panel", "shocked", "electrocut", "exposed wire", "bare wire", "frayed wire",
      "live wire", "smoke&outlet", "smoke&panel", "smoke&wire", "fire&outlet", "fire&wire", "fire&panel",
      "caught fire", "on fire", "flames", "water&outlet", "water&panel", "wet&outlet", "wet&panel",
    ],
  },
  {
    category: "structural",
    keywords: [
      "structural", "load bearing", "foundation&crack", "foundation&shift", "foundation&sink", "sagging ceiling",
      "sagging floor", "ceiling&sag", "ceiling&collaps", "ceiling&bulg", "ceiling&cave", "ceiling&caving",
      "floor&sag", "floor&collaps", "soft spot&floor", "joist", "rafter", "beam&crack", "beam&sag", "beam&split",
      "wall&bowing", "wall&bulg", "wall&collaps", "wall&lean", "roof&sag", "roof&collaps", "sinkhole", "chimney&lean",
    ],
  },
  {
    category: "flooding",
    keywords: [
      "flood", "burst", "gushing", "water everywhere", "water pouring", "pouring water", "water&spraying",
      "spraying water", "cant stop the water", "cant turn off the water", "cant shut off the water",
      "cant shut the water off", "cant find the shutoff", "cant find the shut off", "cant reach the shutoff",
      "cant reach the shut off", "shutoff&wont turn", "shutoff&wont close", "shutoff&broke", "shutoff&stuck",
      "shutoff&seized", "shut off&wont turn", "shut off&wont close", "shut off&broke", "shut off&stuck",
      "valve&wont turn", "valve&wont close", "valve&broke", "valve&stuck", "inches of water",
      "water coming through the ceiling", "water pouring through",
    ],
  },
  {
    category: "sewage",
    keywords: [
      "sewage", "sewer backup", "sewer back", "sewer line", "sewer main", "sewer&overflow", "sewer&flood",
      "sewer&coming up", "backing up&shower", "backing up&tub", "backing up&floor drain", "backed up&shower",
      "backed up&tub", "every drain", "all drains", "all the drains", "all of the drains", "all my drains",
      "multiple drains", "several drains", "other drains", "more than one drain", "multiple fixtures",
      "several fixtures", "more than one fixture", "other fixtures", "shower&toilet&back", "tub&toilet&back",
      "comes up&shower", "coming up&shower", "comes up&tub", "coming up&tub", "comes up&floor drain",
      "coming up&floor drain", "floor drain&back", "main line&back", "main drain&back", "main line&clog",
      "main drain&clog", "septic&back", "septic&overflow", "septic&gurgl",
    ],
  },
  {
    category: null,
    keywords: [
      "child$", "children", "childs", "kid$", "kids$", "kiddo", "son$", "sons$", "daughter", "toddler", "baby$",
      "babies", "infant", "teen", "teens", "teenager", "teenage", "underage", "under 18", "under eighteen",
      "minors$", "boy$", "boys$", "girl$", "girls$", "grandson", "granddaughter", "grandchild", "nephew", "niece",
      "my little one", "little ones$",
    ],
  },
];

/** Child-safety hardware is about the appliance, not a child being involved. */
const CHILD_SAFE_PHRASES: readonly string[] = ["child lock", "child safety", "childproof", "child proof", "child resistant", "kid proof"];

/** The first rule that matches `text`, or undefined when the text is safe to triage. */
export function evaluateHardStop(text: string): HardStopRule | undefined {
  const normalised = normalise(text);
  const withoutSafeHardware = stripPhrases(normalised, CHILD_SAFE_PHRASES);
  return HARD_STOP_RULES.find((rule) =>
    matchesAnyNormalised(rule.category === null ? withoutSafeHardware : normalised, rule.keywords),
  );
}

/** Who to hand off to on a hard stop. */
export const HARD_STOP_TRADE: Readonly<Record<SafetyCategory | "minors", Trade>> = {
  gas: "gas_utility",
  electrical: "electrician",
  structural: "general",
  flooding: "plumber",
  sewage: "plumber",
  minors: "general",
};
