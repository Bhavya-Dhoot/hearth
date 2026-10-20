import { extractUiMeta, type Turn } from "@hearth/host-sim-core";

/** A calm end-of-flow screen: replaces a stale widget with the line Alexa just said. */
export type Settled = { label: string; text: string };

const LABEL_COMPLETION = "LOGGED TO YOUR HOME TIMELINE";
const LABEL_STOP = "SAFETY STOP";

/**
 * Looks at the tool results of the turn that just ran (everything after the last user turn) in order.
 * A voice-only tool that ends a flow (log_completion, or triage_issue with a hard stop) leaves the last
 * widget stale; a later visual tool result in the same turn wins over it. Returns the label for the
 * settled screen when the turn ends on such a result, otherwise null.
 */
export function settledLabel(turns: Turn[]): string | null {
  let start = 0;
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i]?.role === "user") {
      start = i + 1;
      break;
    }
  }
  let label: string | null = null;
  for (const t of turns.slice(start)) {
    if (t.role !== "tool" || t.result.isError) continue;
    if (extractUiMeta(t.result)) {
      label = null;
    } else if (t.name === "log_completion") {
      label = LABEL_COMPLETION;
    } else if (t.name === "triage_issue") {
      const safety = t.result.structuredContent?.safety as { hardStop?: boolean } | undefined;
      if (safety?.hardStop === true) label = LABEL_STOP;
    }
  }
  return label;
}
