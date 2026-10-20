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
  /** Phrases that look like a trigger but are not; stripped (with the rest of their word) before matching. */
  readonly safePhrases?: readonly string[];
  /** Extra check over normalised, misspelling-corrected text, for rules a keyword list cannot express. */
  readonly matches?: (normalised: string) => boolean;
}

/**
 * Common misspellings, corrected token by token before any rule runs. An explicit table, not fuzzy
 * matching: every entry was chosen on purpose, so no rule can fire on a near-miss word by accident.
 */
const MISSPELLINGS: Readonly<Record<string, string>> = {
  smel: "smell",
  smelll: "smell",
  rotton: "rotten",
  roten: "rotten",
  sparkss: "sparks",
};

/** "gass" is only read as gas next to a smell word; on its own it is left alone. */
const GAS_TYPO = "gass";
const SMELL_WORDS: ReadonlySet<string> = new Set(["smell", "smells", "smelling", "odor", "odour", "stink", "stinks", "rotten", "egg", "eggs"]);

export function correctMisspellings(normalised: string): string {
  const tokens = normalised.split(" ").map((token) => (Object.hasOwn(MISSPELLINGS, token) ? MISSPELLINGS[token]! : token));
  const hasSmellContext = tokens.some((token) => SMELL_WORDS.has(token));
  return tokens.map((token) => (token === GAS_TYPO && hasSmellContext ? "gas" : token)).join(" ");
}

/** Child-safety hardware is about the appliance, not a child being involved. */
const CHILD_SAFE_PHRASES: readonly string[] = ["child lock", "child safety", "childproof", "child proof", "child resistant", "kid proof"];

const CHILD_WORDS: ReadonlySet<string> = new Set([
  "child", "childs", "children", "kid", "kids", "kiddo", "kiddos", "son", "sons", "daughter", "daughters", "toddler", "toddlers",
  "teen", "teens", "teenager", "teenagers", "teenage", "baby", "babies", "infant", "infants", "boy", "boys", "girl", "girls",
  "grandson", "grandsons", "granddaughter", "granddaughters", "grandchild", "grandchildren", "grandkid", "grandkids",
  "nephew", "nephews", "niece", "nieces",
]);

/** A child word followed closely by one of these means the child is doing or helping with the repair. */
const INVOLVEMENT_VERBS: ReadonlySet<string> = new Set([
  "do", "does", "doing", "fix", "fixes", "fixing", "help", "helps", "helping", "hold", "holds", "holding", "use", "uses", "using",
  "climb", "climbs", "climbing", "reach", "reaches", "reaching", "replace", "replaces", "replacing", "install", "installs",
  "installing", "turn", "turns", "turning", "tighten", "tightens", "tightening", "loosen", "loosens", "loosening", "cut", "cuts",
  "cutting", "handle", "handles", "handling", "try", "tries", "trying", "repair", "repairs", "repairing", "touch", "touches",
  "touching", "pull", "pulls", "pulled", "pulling", "push", "pushes", "pushing", "open", "opens", "opening", "remove", "removes",
  "removing", "unscrew", "unscrews", "unscrewing", "screw", "screws", "grab", "grabs", "carry", "carries", "plug", "unplug",
]);
const MODALS: ReadonlySet<string> = new Set(["will", "can", "could", "would", "should", "gonna"]);
/** Words just before a child word that hand the job to the child ("let the kids use the wrench"). */
const HANDING_OVER: ReadonlySet<string> = new Set(["let", "lets", "letting", "allow", "allows", "allowing"]);
/** Personal details: a child word near one of these means the customer is giving or asking to store details. */
const DETAIL_WORDS: ReadonlySet<string> = new Set([
  "name", "names", "named", "age", "aged", "school", "schools", "birthday", "birthdate", "photo", "photos", "picture", "pictures",
  "profile", "asthma", "allergy", "allergies", "allergic", "sick", "health", "medication", "medicine", "diagnosed", "disability",
]);
const AGE_LINKS: ReadonlySet<string> = new Set(["is", "was", "turned", "turns", "aged", "age"]);
const YEAR_WORDS: ReadonlySet<string> = new Set(["year", "years", "yr", "yrs"]);
const MONTH_WORDS: ReadonlySet<string> = new Set(["month", "months"]);
/** "my 9 year old" is a child unless the next word shows it is a thing ("my 9 year old water heater"). */
const AGE_PREFIXES: ReadonlySet<string> = new Set(["my", "our", "his", "her", "their", "a", "an", "the", "this", "that", "another"]);
const THINGS: ReadonlySet<string> = new Set([
  "house", "home", "build", "building", "roof", "furnace", "boiler", "heater", "waterheater", "ac", "unit", "system", "dishwasher",
  "washer", "dryer", "fridge", "refrigerator", "freezer", "stove", "oven", "range", "disposal", "toilet", "faucet", "tank", "pipe",
  "pipes", "water", "appliance", "microwave", "panel", "breaker", "car", "truck", "apartment", "condo", "kitchen", "bathroom", "deck",
  "fence", "shingles", "windows", "window", "doors", "door", "floor", "carpet", "paint", "pump", "sump", "thermostat", "filter",
  "valve", "sink", "tub", "shower", "wiring", "wire", "outlet", "switch", "gasket", "seal",
]);

const isAge = (token: string | undefined): boolean => token !== undefined && /^\d{1,2}$/.test(token) && Number(token) < 18;

/** True when a number below 18 reads as a child's age: "my 9 year old", "my 10yo", "a 6 months old". */
function hasChildAge(tokens: readonly string[]): boolean {
  return tokens.some((token, i) => {
    const compact = /^(d{1,2})(?:yo|yr|yrs|yearold)$/.exec(token);
    let next: string | undefined;
    if (compact) {
      if (Number(compact[1]) >= 18) return false;
      next = tokens[i + 1] === "old" ? tokens[i + 2] : tokens[i + 1];
    } else {
      const unit = tokens[i + 1] ?? "";
      if (!isAge(token) || !(YEAR_WORDS.has(unit) || MONTH_WORDS.has(unit)) || tokens[i + 2] !== "old") return false;
      next = tokens[i + 3];
    }
    return AGE_PREFIXES.has(tokens[i - 1] ?? "") && !THINGS.has(next ?? "");
  });
}

/** True when a child is doing or helping with the repair, or the text gives a child's personal details. */
function involvesMinor(normalised: string): boolean {
  const tokens = normalised.replace(/\bmy little ones?\b/g, "my kiddo").split(" ");
  if (hasChildAge(tokens)) return true;
  return tokens.some((token, i) => {
    if (!CHILD_WORDS.has(token)) return false;
    const before = tokens.slice(Math.max(0, i - 3), i);
    const after = tokens.slice(i + 1, i + 6);
    if (before.some((t) => HANDING_OVER.has(t))) return true;
    if (MODALS.has(after[0] ?? "") || ((after[0] === "going" || after[0] === "wants" || after[0] === "want") && after[1] === "to")) return true;
    if (after.some((t) => INVOLVEMENT_VERBS.has(t) || DETAIL_WORDS.has(t))) return true;
    return after.slice(0, 4).some((t, j) => AGE_LINKS.has(t) && isAge(after[j + 1]));
  });
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
      "spark$", "sparks$", "sparked$", "sparking$", "arcing", "outlet&burn", "outlet&smoke", "outlet&melt", "outlet&hot",
      "outlet&scorch", "outlet&smell",
      "switch&burn", "switch&smoke", "panel&burn", "panel&smoke", "panel&hot", "panel&warm", "panel&buzz", "panel&hum",
      "panel&crackl", "panel&sizzl", "breaker&burn", "breaker&smoke", "breaker&hot", "breaker&buzz", "wire&burn",
      "wire&smoke", "cord&burn", "cord&melt",
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
    safePhrases: ["spark plug"],
  },
  {
    category: "structural",
    keywords: [
      "structural", "load bearing", "foundation&crack", "foundation&shift", "foundation&sink", "sagging ceiling",
      "sagging floor", "ceiling&sag", "ceiling&collaps", "ceiling&bulg", "ceiling&cave", "ceiling&caving",
      "floor&sag", "floor&collaps", "soft spot&floor", "joist", "rafter", "beam&crack", "beam&sag", "beam&split",
      "wall&bowing", "wall&bulg", "wall&collaps", "wall&lean", "roof&sag", "roof&collaps", "sinkhole", "chimney&lean",
      "wall&crack", "wall&sag", "ceiling&crack", "foundation&bulg", "door&stick&crack", "door&jam&crack",
      "door&wont close&crack", "door&wont shut&crack",
    ],
  },
  {
    category: "flooding",
    keywords: [
      "flood$", "floods$", "flooded$", "flooding$", "floodwater", "burst&pipe", "burst&hose", "burst&line$",
      "burst&waterheater", "burst&supply", "burst&main", "burst&tank", "gushing", "water everywhere", "water pouring",
      "pouring water", "water is pouring", "water&pouring in", "water&still&pouring", "water&still&coming in",
      "water&still&coming through", "water&still&gushing", "water&still&spraying", "water&still&shutoff",
      "water&still&shut off", "water&still rising", "water rising", "water is rising", "water keeps rising",
      "water&spraying", "spraying water", "cant stop the water", "cant turn off the water", "cant shut off the water",
      "cant shut the water off", "cant find the shutoff", "cant find the shut off", "cant reach the shutoff",
      "cant reach the shut off", "shutoff&wont turn", "shutoff&wont close", "shutoff&broke", "shutoff&stuck",
      "shutoff&seized", "shut off&wont turn", "shut off&wont close", "shut off&broke", "shut off&stuck",
      "valve&wont turn", "valve&wont close", "valve&broke", "valve&stuck", "inches of water",
      "water coming through the ceiling", "water pouring through",
    ],
    safePhrases: ["flood light", "floodlight", "flood lamp"],
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
      "main drain&clog", "septic&back", "septic&overflow", "septic&gurgl", "septic&alarm",
    ],
  },
  {
    category: null,
    keywords: ["underage", "under 18$", "under eighteen"],
    safePhrases: CHILD_SAFE_PHRASES,
    matches: involvesMinor,
  },
];

/** The first rule that matches `text`, or undefined when the text is safe to triage. */
export function evaluateHardStop(text: string): HardStopRule | undefined {
  const normalised = correctMisspellings(normalise(text));
  return HARD_STOP_RULES.find((rule) => {
    const scanned = rule.safePhrases ? stripPhrases(normalised, rule.safePhrases) : normalised;
    return matchesAnyNormalised(scanned, rule.keywords) || (rule.matches?.(scanned) ?? false);
  });
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
