import { SYNONYMS } from "./synonyms";

/**
 * Deterministic keyword matching shared by triage and the safety rules.
 *
 * Expression grammar (all matching is case-insensitive and on normalised text):
 *   term        a word or phrase, matched at the start of a word ("leak" matches "leaking").
 *               A trailing "$" requires the whole word ("son$" does not match "sonic").
 *   a&b         every term must appear somewhere in the text.
 *   a|b         (route keys only) any alternative may match.
 * When `expand` is true a term that names a concept in SYNONYMS stands for every surface form of
 * that concept. Safety rules and escalation keywords never expand: they are literal on purpose.
 */

const COMPOUNDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:hot water (?:heater|tank)|water heater)s?\b/g, "waterheater"],
];

/** Lower-case, drop apostrophes, turn every other non-alphanumeric run into one space. */
export function normalise(input: string): string {
  let text = input.toLowerCase().replace(/['\u2018\u2019\u02bc]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  for (const [pattern, replacement] of COMPOUNDS) text = text.replace(pattern, replacement);
  return text;
}

interface Form {
  readonly phrase: string;
  readonly whole: boolean;
}

function parseForm(raw: string): Form {
  const whole = raw.endsWith("$");
  return { phrase: normalise(whole ? raw.slice(0, -1) : raw), whole };
}

const literalCache = new Map<string, Form>();
const conceptCache = new Map<string, readonly Form[]>();

function literalForm(term: string): Form {
  let form = literalCache.get(term);
  if (!form) {
    form = parseForm(term);
    literalCache.set(term, form);
  }
  return form;
}

function conceptForms(name: string): readonly Form[] | undefined {
  const cached = conceptCache.get(name);
  if (cached) return cached;
  const forms = Object.hasOwn(SYNONYMS, name) ? SYNONYMS[name]!.map(parseForm) : undefined;
  if (forms) conceptCache.set(name, forms);
  return forms;
}

function formMatches(padded: string, form: Form): boolean {
  return padded.includes(form.whole ? ` ${form.phrase} ` : ` ${form.phrase}`);
}

function termMatches(padded: string, term: string, expand: boolean): boolean {
  const literal = literalForm(term);
  const forms = expand ? conceptForms(literal.phrase) : undefined;
  return (forms ?? [literal]).some((form) => formMatches(padded, form));
}

function exprMatches(padded: string, expr: string, expand: boolean): boolean {
  return expr.split("&").every((term) => termMatches(padded, term.trim(), expand));
}

/** True when any expression in `exprs` matches `text` (raw text; it is normalised here). */
export function matchesAny(text: string, exprs: readonly string[], expand = false): boolean {
  return matchesAnyNormalised(normalise(text), exprs, expand);
}

/** Same as matchesAny for text that has already been through normalise(). */
export function matchesAnyNormalised(normalised: string, exprs: readonly string[], expand = false): boolean {
  const padded = ` ${normalised} `;
  return exprs.some((expr) => exprMatches(padded, expr, expand));
}

/** Number of "&" terms in a matching expression; more specific symptoms weigh more. */
export function exprWeight(expr: string): number {
  return expr.split("&").length;
}

/** Route keys list alternatives with "|"; every alternative may use "&" and concept names. */
export function routeKeyMatches(normalisedAnswer: string, key: string): boolean {
  return matchesAnyNormalised(normalisedAnswer, key.split("|"), true);
}

/** Remove every listed phrase, plus the rest of the word it ends in, from already-normalised text. */
export function stripPhrases(normalised: string, phrases: readonly string[]): string {
  let out = ` ${normalised}`;
  for (const phrase of phrases) out = out.replace(new RegExp(` ${normalise(phrase)}[a-z0-9]*`, "g"), " ");
  return out.replace(/\s+/g, " ").trim();
}
