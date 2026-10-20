export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
export const money = (n: number): string => `$${n.toFixed(2)}`;
export const toCents = (n: number): number => Math.round(n * 100);

export const capitalize = (s: string): string => (s.length === 0 ? s : `${s[0]?.toUpperCase() ?? ""}${s.slice(1)}`);

/** Lower-case snake key used for categories and ids. */
export const slug = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const SIZE = /(\d{1,2})\s*[x×]\s*(\d{1,2})\s*[x×]\s*(\d{1,2})/i;
const SIZE_ALL = /(\d{1,2})\s*[x×]\s*(\d{1,2})\s*[x×]\s*(\d{1,2})/gi;

/** "16×25×1" and "16 x 25 x 1" both become "16x25x1". */
export function findSize(text: string): string | undefined {
  const m = SIZE.exec(text);
  return m ? `${m[1]}x${m[2]}x${m[3]}` : undefined;
}

/** "Furnace filter" becomes "furnace filter"; acronyms such as "HVAC" are left alone. */
export const lcFirst = (s: string): string => (/^[A-Z][a-z]/.test(s) ? `${s.charAt(0).toLowerCase()}${s.slice(1)}` : s);

export const normalizeSizes = (text: string): string => text.replace(SIZE_ALL, "$1x$2x$3");

/** Keeps spoken and card text free of em and en dashes. */
const LONG_DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`, "g");
export const plain = (s: string): string => s.replace(LONG_DASHES, "-");

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 3).trimEnd()}...`;
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
