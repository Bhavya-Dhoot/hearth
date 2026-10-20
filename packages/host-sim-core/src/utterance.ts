import { WidgetAction } from "@hearth/contracts";
import { z } from "zod";
import { isRecord } from "./traffic";

/**
 * Text conventions that let voice and touch converge (PRD 9.1):
 *   "[tap] next_step {"issueId":"...","stepIndex":2}"   a widget tap, as a user turn
 *   "[photo] {"brand":"Rheem",...}"                      a label photo whose fields the host already extracted
 */

export const TAP_PREFIX = "[tap]";
export const PHOTO_PREFIX = "[photo]";

/** "[tap] next_step {...}" for a widget action (PRD 9.1). */
export function actionToUtterance(a: WidgetAction): string {
  return `${TAP_PREFIX} ${a.name} ${JSON.stringify(a.args)}`;
}

/** Inverse of actionToUtterance. Returns null for anything that is not a well-formed widget tap. */
export function parseTapUtterance(text: string): WidgetAction | null {
  const m = /^\[tap\]\s+([a-z_]+)(?:\s+(.*))?$/s.exec(text.trim());
  if (!m) return null;
  let args: unknown = {};
  if (m[2] !== undefined && m[2].trim() !== "") {
    try {
      args = JSON.parse(m[2]);
    } catch {
      return null;
    }
  }
  const parsed = WidgetAction.safeParse({ name: m[1], args });
  return parsed.success ? parsed.data : null;
}

/** Fields the host's vision step read from a label photo (done before add_asset, tools.ts AddAssetInput.photoUrl). */
export const LabelPhoto = z.object({
  photoUrl: z.string().url().optional(),
  brand: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  serial: z.string().min(1).optional(),
  installYear: z.number().int().min(1900).max(2100).optional(),
  /** Where the customer said the item lives when the photo was captured. */
  room: z.string().min(2).optional(),
});
export type LabelPhoto = z.infer<typeof LabelPhoto>;

export function photoToUtterance(p: LabelPhoto): string {
  return `${PHOTO_PREFIX} ${JSON.stringify(p)}`;
}

export function parsePhotoUtterance(text: string): LabelPhoto | null {
  const m = /^\[photo\]\s*(.*)$/s.exec(text.trim());
  if (!m) return null;
  let raw: unknown = {};
  if (m[1] !== undefined && m[1].trim() !== "") {
    try {
      raw = JSON.parse(m[1]);
    } catch {
      return null;
    }
  }
  if (!isRecord(raw)) return null;
  const parsed = LabelPhoto.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/* ------------------------------------------------------------------ plain-text normalisation */

const WAKE = /^\s*(?:hey\s+|ok\s+|okay\s+)?alexa\b[\s,.:;!-]*/i;

/** What the customer said, without the wake word and surrounding whitespace. */
export function stripWakeWord(text: string): string {
  return text.replace(WAKE, "").trim();
}

/** Lower-case, curly quotes straightened, wake word and trailing punctuation removed, spaces collapsed. */
export function normalizeText(text: string): string {
  return stripWakeWord(text)
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[.!?,;:\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const YES_CORE = "(?:yes|yeah|yep|yup|sure|confirm|confirmed|go ahead|do it|order it|place it|place (?:the|my|that) order|that'?s right|correct|affirmative)";
const YES_TAIL = "(?:please|confirm|go ahead|order it|do it|place (?:the|my|that) order|thanks|thank you)";
const EXPLICIT_YES = new RegExp(`^${YES_CORE}(?:[ ,]+${YES_TAIL})*$`);

/**
 * An explicit, whole-utterance yes. "Yes but..." and "okay" are not explicit: money moves only on a clear yes.
 */
export function isExplicitYes(text: string): boolean {
  return EXPLICIT_YES.test(normalizeText(text).replace(/,/g, " ").replace(/\s+/g, " "));
}

/** A no, a cancel, or a hesitation. */
export function isNo(text: string): boolean {
  return /^(?:no|nope|nah|cancel|stop|wait|hold on|don'?t|never ?mind|not now|negative)\b/.test(normalizeText(text));
}

/** A lighter yes for low-stakes offers such as "want me to put together a brief?". */
export function isOfferYes(text: string): boolean {
  const n = normalizeText(text).replace(/,/g, " ").replace(/\s+/g, " ");
  return isExplicitYes(text) || /^(?:okay|ok|alright|all right|please|yes please|sounds good|find (?:one|a \w+)|do that|let'?s do it)(?: please)?$/.test(n);
}

/* ------------------------------------------------------------------ small text helpers shared by the orchestrators */

export const capFirst = (s: string): string => (s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1));

/** Adds a full stop unless the text already ends a sentence. */
export function ensureEnd(s: string): string {
  const t = s.trim();
  if (t === "") return t;
  return /[.!?]["')\]]?$/.test(t) ? t : `${t}.`;
}

export const money = (n: number): string => `$${n.toFixed(2)}`;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/** "Thursday, October 22" from "2026-10-22", computed in UTC so the host time zone never shifts the day. */
export function longDate(iso: string, withYear = false): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const weekday = WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  const month = MONTHS[mo - 1];
  if (!weekday || !month) return iso;
  return withYear ? `${month} ${d}, ${y}` : `${weekday}, ${month} ${d}`;
}
