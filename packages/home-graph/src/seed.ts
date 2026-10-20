import { SeedFile, type HomeRepository } from "@hearth/contracts";
import seedJson from "../seed/okafor-house.json";

/** Every date in seed/okafor-house.json is authored relative to this day (PRD Appendix C, J3). */
export const SEED_BASE_DATE = "2026-10-21";
export const DEFAULT_MCP_BASE = "http://localhost:4200";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T/;
const MS_PER_DAY = 86_400_000;

const utcDay = (isoDate: string): number => {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
};

/** The calendar date of `now` where the seed home lives, as YYYY-MM-DD. */
export function localDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Whole days from the seed base date to the calendar day of `now` in `timeZone`. */
export function dayShift(now: Date, timeZone: string): number {
  return Math.round((utcDay(localDate(now, timeZone)) - utcDay(SEED_BASE_DATE)) / MS_PER_DAY);
}

export function shiftDate(isoDate: string, days: number): string {
  return new Date(utcDay(isoDate) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Shift every date (YYYY-MM-DD) and datetime (date part only, time and offset kept) by whole days. */
function shiftAll(value: unknown, days: number): unknown {
  if (typeof value === "string") {
    if (DATE_ONLY.test(value)) return shiftDate(value, days);
    if (DATE_TIME.test(value)) return `${shiftDate(value.slice(0, 10), days)}${value.slice(10)}`;
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => shiftAll(item, days));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shiftAll(item, days)]));
  }
  return value;
}

/** The seed as plain validated data: media base resolved and dates shifted. Exposed for tests and tooling. */
export function buildSeed(opts: { now?: Date; mcpBase?: string } = {}): SeedFile {
  const mcpBase = (opts.mcpBase ?? DEFAULT_MCP_BASE).replace(/\/+$/, "");
  const resolved: unknown = JSON.parse(JSON.stringify(seedJson).replaceAll("{{MCP_BASE}}", mcpBase));
  const days = opts.now ? dayShift(opts.now, (seedJson as { home: { timezone: string } }).home.timezone) : 0;
  return SeedFile.parse(days === 0 ? resolved : shiftAll(resolved, days));
}

/**
 * Idempotently load "The Okafor House" (Appendix C). Re-running with the same options rewrites
 * the same records. With `now`, every date moves by the whole-day difference between today (in the
 * home's time zone) and 2026-10-21, so the demo reads the same on any day.
 */
export async function loadSeed(repo: HomeRepository, opts?: { now?: Date; mcpBase?: string }): Promise<void> {
  const seed = buildSeed(opts);
  await repo.putHome(seed.home);
  for (const asset of seed.assets) await repo.putAsset(asset);
  for (const event of seed.events) await repo.putEvent(event);
  for (const task of seed.tasks) await repo.putTask(task);
}
