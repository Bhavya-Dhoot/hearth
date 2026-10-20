import type { VoiceIntent } from "@hearth/contracts";

const ORDINALS: Record<string, number> = {
  first: 1, "1st": 1, one: 1,
  second: 2, "2nd": 2, two: 2,
  third: 3, "3rd": 3, three: 3,
  fourth: 4, "4th": 4, four: 4,
  fifth: 5, "5th": 5, five: 5,
};

/**
 * Cheap, local reading of what was said, so the widget on screen can echo it the instant the words land
 * ("next" lights the NEXT button, "the first one" selects row 1). The utterance still goes to the
 * orchestrator as a normal turn; this only mirrors it on the glass.
 *
 * select_index is ZERO-based ("the first one" is index 0), matching selectedIndex and select_part.index (A0 convention).
 */
export function parseVoiceIntent(raw: string): VoiceIntent | null {
  const t = raw.toLowerCase().replace(/[.,!?]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;

  if (/^(alexa )?(ok(ay)? )?(next|next step|go on|go ahead|continue|keep going)$/.test(t)) return { kind: "next" };

  if (t.split(" ").length <= 7) {
    const word =
      /\b(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th)\b/.exec(t)?.[1] ??
      /\b(?:number|option|item|#)\s*(one|two|three|four|five|[1-5])\b/.exec(t)?.[1] ??
      /^(?:order |pick |take |show )?(?:the )?(one|two|three|four|five)$/.exec(t)?.[1];
    const index = word ? (ORDINALS[word] ?? Number(word)) : undefined;
    if (index) return { kind: "select_index", index: index - 1 };
  }

  if (/^(alexa )?(yes|yeah|yep|confirm|confirmed|yes please|yes confirm|do it|go ahead and order)\b/.test(t)) return { kind: "confirm" };
  if (/^(alexa )?(no|nope|cancel|never mind|nevermind|stop|don't)\b/.test(t)) return { kind: "cancel" };
  return null;
}
