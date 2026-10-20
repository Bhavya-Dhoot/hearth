import { readFileSync } from "node:fs";
import { GENERIC_MEDIA, Playbook, SafetyCategory } from "@hearth/contracts";
import { parse as parseYaml } from "yaml";
import { PLACEHOLDER_KEYS, PLACEHOLDER_PATTERN } from "./template";

/** Appendix D order. Triage breaks score ties in this order, so it is part of the behaviour. */
export const PLAYBOOK_IDS = [
  "leak-under-sink-ptrap",
  "leak-under-sink-supply-line",
  "disposal-hum-jam",
  "disposal-leak-body",
  "toilet-running",
  "toilet-clog",
  "breaker-tripped",
  "ac-not-cooling",
  "furnace-not-heating",
  "water-heater-no-hot",
  "dishwasher-not-draining",
  "smoke-detector-chirp",
] as const;

const DASHES = /[\u2012\u2013\u2014\u2015\u2212]/;

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, out);
  else if (value !== null && typeof value === "object") for (const item of Object.values(value)) collectStrings(item, out);
  return out;
}

/** Validate one parsed YAML document against the Playbook schema and the house style rules. */
export function parsePlaybook(raw: unknown, expectedId: string): Playbook {
  const result = Playbook.safeParse(raw);
  if (!result.success) {
    throw new Error(`Playbook "${expectedId}" is invalid: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const playbook = result.data;
  if (playbook.id !== expectedId) throw new Error(`Playbook file "${expectedId}" declares id "${playbook.id}"`);
  if (playbook.steps.length === 0) throw new Error(`Playbook "${expectedId}" has no steps`);

  for (const text of collectStrings(playbook)) {
    if (DASHES.test(text)) throw new Error(`Playbook "${expectedId}" contains an en dash or em dash: "${text}"`);
    for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
      const [, key, fallback] = match;
      if (!(PLACEHOLDER_KEYS as readonly string[]).includes(key!)) throw new Error(`Playbook "${expectedId}" uses unknown placeholder {${key}}`);
      if (fallback === undefined) throw new Error(`Playbook "${expectedId}" placeholder {${key}} has no fallback`);
    }
  }
  for (const [index, step] of playbook.steps.entries()) {
    if (step.fallbackImage !== undefined && !Object.hasOwn(GENERIC_MEDIA, step.fallbackImage)) {
      throw new Error(`Playbook "${expectedId}" step ${index} uses unknown fallbackImage "${step.fallbackImage}"`);
    }
    if (step.partRole !== undefined && !playbook.partRoles.includes(step.partRole)) {
      throw new Error(`Playbook "${expectedId}" step ${index} needs part role "${step.partRole}" that partRoles does not list`);
    }
  }
  return playbook;
}

/** Check every question route points at something that exists. */
export function validateRoutes(playbooks: readonly Playbook[]): void {
  const ids = new Set(playbooks.map((p) => p.id));
  for (const playbook of playbooks) {
    for (const [index, question] of playbook.questions.entries()) {
      for (const [key, destination] of Object.entries(question.routes)) {
        const where = `Playbook "${playbook.id}" question "${question.id}" route "${key}"`;
        if (destination.startsWith("question:")) {
          const target = playbook.questions.findIndex((q) => q.id === destination.slice("question:".length));
          if (target <= index) throw new Error(`${where} must point to a later question of the same playbook`);
        } else if (destination.startsWith("escalate:")) {
          if (destination.slice("escalate:".length).trim() === "") throw new Error(`${where} escalates without a reason`);
        } else if (destination.startsWith("hardstop:")) {
          if (!SafetyCategory.safeParse(destination.slice("hardstop:".length)).success) throw new Error(`${where} names an unknown safety category`);
        } else if (!ids.has(destination)) {
          throw new Error(`${where} points at unknown playbook "${destination}"`);
        }
      }
    }
  }
}

/** Read, parse and validate all twelve playbooks from `dir`. Fails loudly on the first problem. */
export function loadPlaybooks(dir: URL): Playbook[] {
  const playbooks = PLAYBOOK_IDS.map((id) => {
    const file = new URL(`${id}.yaml`, dir);
    return parsePlaybook(parseYaml(readFileSync(file, "utf8")), id);
  });
  validateRoutes(playbooks);
  return playbooks;
}
