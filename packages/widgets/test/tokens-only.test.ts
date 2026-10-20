import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Everything that draws a widget. fonts.css is the one place font family names may appear (the @font-face rules). */
const files = ["src/widgets", "src/runtime", "src/styles"].flatMap((d) => walk(join(root, d))).filter((f) => !f.endsWith("fonts.css"));

const rules: Array<{ name: string; pattern: RegExp }> = [
  { name: "hex colour literal", pattern: /#[0-9a-fA-F]{3,8}\b/ },
  { name: "rgb()/rgba() literal", pattern: /\brgba?\s*\(/i },
  { name: "hsl()/hsla() literal", pattern: /\bhsla?\s*\(/i },
  { name: "font-family literal", pattern: /font-family\s*:(?!\s*var\()/i },
  { name: "font family name", pattern: /Fraunces|Instrument Sans|JetBrains Mono|Inter\b|Roboto|Arial|Helvetica/ },
  { name: "gradient", pattern: /gradient\s*\(/i },
  { name: "drop shadow", pattern: /box-shadow|drop-shadow|text-shadow|backdrop-filter/i },
  { name: "em or en dash", pattern: /[–—]/ },
  { name: "emoji", pattern: /\p{Extended_Pictographic}/u },
  { name: "a Buy label", pattern: /["'>]Buy(?![a-z])/ },
  { name: "placeholder copy", pattern: /lorem ipsum|TODO|FIXME/i },
];

describe("tokens only", () => {
  it("scans a meaningful set of files", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const rule of rules) {
    it(`no ${rule.name} in src/widgets, src/runtime or src/styles`, () => {
      const hits = files.filter((file) => rule.pattern.test(readFileSync(file, "utf8"))).map((f) => relative(root, f));
      expect(hits).toEqual([]);
    });
  }

  it("never sets colours or fonts inline from TypeScript", () => {
    const ts = files.filter((f) => f.endsWith(".ts"));
    const hits = ts.filter((file) => /style\.(color|background|fontFamily)\s*=|"(color|background|font-family)"\s*:/.test(readFileSync(file, "utf8"))).map((f) => relative(root, f));
    expect(hits).toEqual([]);
  });
});
