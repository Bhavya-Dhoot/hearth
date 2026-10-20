const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export const money = (amount: number): string => usd.format(amount);

const dayFormat = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** The calendar date part of an ISO date or date-time, read as written (no timezone shifting). */
function calendarDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

/** "Fri, Oct 23" for an IsoDate such as "2026-10-23". */
export const weekdayDate = (iso: string): string => dayFormat.format(calendarDate(iso));

/** "Oct 15, 2026" for an IsoDate or IsoDateTime. */
export const shortDate = (iso: string): string => dateFormat.format(calendarDate(iso));

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"] as const;
/** What a person says to pick row `index` (zero-based): "the first one". */
export const ordinalPhrase = (index: number): string => `the ${ORDINALS[index] ?? `number ${index + 1}`} one`;

export const plural = (n: number, one: string, many = `${one}s`): string => (n === 1 ? one : many);

/** Humanises an inventory type key such as "shutoff" for display. */
export const typeLabel = (type: string, count: number): string => {
  const labels: Record<string, [string, string]> = {
    appliance: ["appliance", "appliances"],
    fixture: ["fixture", "fixtures"],
    shutoff: ["shut-off", "shut-offs"],
    panel: ["panel", "panels"],
    hvac: ["HVAC unit", "HVAC units"],
    consumable: ["consumable", "consumables"],
  };
  const pair = labels[type];
  return pair ? (count === 1 ? pair[0] : pair[1]) : type;
};

/** A URL as text nodes with <wbr> after each slash, so it wraps at path boundaries instead of mid-word. */
export const breakableUrl = (url: string): Array<string | HTMLElement> => {
  const parts = url.split(/(?<=\/)/);
  return parts.flatMap((part, i) => (i < parts.length - 1 ? [part, document.createElement("wbr")] : [part]));
};
