import type { HardStopResult, SafetyCategory } from "@hearth/contracts";
import { SAFETY_MESSAGES } from "./messages";
import { evaluateHardStop } from "./rules";

export { SAFETY_MESSAGES } from "./messages";
export { HARD_STOP_RULES, HARD_STOP_TRADE, evaluateHardStop, type HardStopRule, type Trade } from "./rules";

/** Deterministic hard-stop check over free text. Always runs first inside triage. */
export function checkHardStop(text: string): HardStopResult {
  const rule = evaluateHardStop(text);
  if (!rule) return { hardStop: false };
  if (rule.category === null) return { hardStop: true, message: SAFETY_MESSAGES.minors };
  return { hardStop: true, category: rule.category, message: SAFETY_MESSAGES[rule.category] };
}

/** Hard-stop result for a known category (used by playbook hard stops and "hardstop:" routes). */
export function hardStopFor(category: SafetyCategory): HardStopResult {
  return { hardStop: true, category, message: SAFETY_MESSAGES[category] };
}
