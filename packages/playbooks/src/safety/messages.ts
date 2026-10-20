import type { SafetyCategory } from "@hearth/contracts";

/**
 * Verbatim hard-stop messages, keyed by category. The orchestrator reads these word for word
 * (PRD 7.4) and gives no repair steps. Plain, direct, no softeners (PRD 10.5).
 * `minors` has no SafetyCategory: it is the policy line for anything involving children.
 */
export const SAFETY_MESSAGES: Readonly<Record<SafetyCategory | "minors", string>> = {
  gas: "Stop. If you smell gas, leave the house now and call your gas company from outside. I won't give steps for this.",
  electrical:
    "Stop. Keep away from that outlet, switch or panel, and don't open or touch anything inside it. If you see smoke or flames, leave and call 911. Otherwise call a licensed electrician. I won't give steps for this.",
  structural:
    "Stop. Keep everyone out from under that area, and don't prop, patch or cut anything. Call a licensed contractor or structural engineer today, and if anything is moving or falling, leave and call 911. I won't give steps for this.",
  flooding:
    "Stop. If you can reach your main water shut-off, close it now. If you can't, or the water is still rising, leave the wet area, stay clear of outlets and call a plumber or your water utility's emergency line. I won't give repair steps for this.",
  sewage:
    "Stop. Don't use any more water in the house, and keep clear of the backup because it's contaminated. Call a plumber who handles sewer lines. I won't give steps for this.",
  minors:
    "Please have an adult handle this. Hearth is for adults, so I can't take it on with a child involved, and I won't store any details about children.",
};
