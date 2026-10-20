/** Calendar helpers. All dates are YYYY-MM-DD strings; arithmetic is done in UTC so it never drifts with DST. */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    formatters.set(timeZone, f);
  }
  return f;
}

/** The calendar date of an instant in a time zone. Falls back to UTC for an unknown zone. */
export function isoDateIn(instant: Date, timeZone: string): string {
  try {
    return formatterFor(timeZone).format(instant);
  } catch {
    return instant.toISOString().slice(0, 10);
  }
}

const dayMs = 86_400_000;
const parse = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);

export function addDays(iso: string, days: number): string {
  return new Date(parse(iso) + days * dayMs).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function diffDays(a: string, b: string): number {
  return Math.round((parse(b) - parse(a)) / dayMs);
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** 0 = Sunday. */
export const weekdayIndex = (iso: string): number => new Date(parse(iso)).getUTCDay();
export const weekdayName = (iso: string): string => WEEKDAYS[weekdayIndex(iso)] ?? "";
export const monthNumber = (iso: string): number => new Date(parse(iso)).getUTCMonth() + 1;
export const dayOfMonth = (iso: string): number => new Date(parse(iso)).getUTCDate();

const monthName = (iso: string): string => MONTHS[monthNumber(iso) - 1] ?? "";
/** "October 24" */
export const longMonthDay = (iso: string): string => `${monthName(iso)} ${dayOfMonth(iso)}`;
/** "Oct 24" */
export const shortMonthDay = (iso: string): string => `${monthName(iso).slice(0, 3)} ${dayOfMonth(iso)}`;
/** "Friday, October 23" */
export const longDate = (iso: string): string => `${weekdayName(iso)}, ${longMonthDay(iso)}`;

/** Delivery date: `shipDays` calendar days out, never counting or landing on a Sunday. */
export function deliveryDate(today: string, shipDays: number): string {
  let date = today;
  let remaining = Math.max(0, shipDays);
  while (remaining > 0) {
    date = addDays(date, 1);
    if (weekdayIndex(date) !== 0) remaining -= 1;
  }
  return weekdayIndex(date) === 0 ? addDays(date, 1) : date;
}

/** The Saturday and Sunday of "this weekend" relative to `today`. Sunday counts as part of the weekend in progress. */
export function comingWeekend(today: string): { saturday: string; sunday: string } {
  const dow = weekdayIndex(today);
  const saturday = dow === 0 ? addDays(today, -1) : addDays(today, 6 - dow);
  return { saturday, sunday: addDays(saturday, 1) };
}

/** "Oct 24-25", or "Oct 31 to Nov 1" across a month boundary. */
export function weekendLabel(saturday: string, sunday: string): string {
  return monthNumber(saturday) === monthNumber(sunday)
    ? `${shortMonthDay(saturday)}-${dayOfMonth(sunday)}`
    : `${shortMonthDay(saturday)} to ${shortMonthDay(sunday)}`;
}

/** Full years between an install date and today. */
export function ageInYears(installDate: string | undefined, today: string): number {
  if (!installDate) return 0;
  return Math.max(0, Math.floor(diffDays(installDate, today) / 365.25));
}
