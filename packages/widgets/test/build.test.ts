import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WidgetName } from "@hearth/contracts";
import { beforeAll, describe, expect, it } from "vitest";
import type { Manifest } from "../src/manifest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const uiDir = join(root, "dist", "ui");
const STALE = "step-card-000000.html";

const CSP = "default-src 'none'; img-src 'self' data: http: https:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:";

const build = (): void => {
  execSync("pnpm exec tsx scripts/build.ts", { cwd: root, stdio: "pipe" });
};
const readManifest = (): Manifest => JSON.parse(readFileSync(join(uiDir, "manifest.json"), "utf8")) as Manifest;

let manifest: Manifest;

beforeAll(() => {
  build();
  // A leftover hashed file from an earlier build must be cleaned by the next one.
  writeFileSync(join(uiDir, STALE), "stale", "utf8");
  build();
  manifest = readManifest();
}, 300_000);

describe("build output", () => {
  it("produces the eight widgets and nothing else but the manifest", () => {
    expect(Object.keys(manifest)).toEqual(["widgets"]);
    expect(Object.keys(manifest.widgets).sort()).toEqual([...WidgetName.options].sort());
    const files = readdirSync(uiDir).sort();
    expect(files).toEqual([...Object.values(manifest.widgets).map((w) => w.file), "manifest.json"].sort());
    expect(existsSync(join(uiDir, STALE))).toBe(false);
  });

  it("manifest entries have exactly file, uri, hash and bytes, and they are true", () => {
    for (const [name, entry] of Object.entries(manifest.widgets)) {
      expect(Object.keys(entry).sort()).toEqual(["bytes", "file", "hash", "uri"]);
      const content = readFileSync(join(uiDir, entry.file));
      const hash = createHash("sha256").update(content).digest("hex").slice(0, 6);
      expect(entry.hash).toBe(hash);
      expect(entry.file).toBe(`${name}-${hash}.html`);
      expect(entry.uri).toBe(`ui://hearth/${entry.file}`);
      expect(entry.bytes).toBe(statSync(join(uiDir, entry.file)).size);
    }
  });

  it("each HTML is self-contained: no external script, link, import or url()", () => {
    for (const entry of Object.values(manifest.widgets)) {
      const html = readFileSync(join(uiDir, entry.file), "utf8");
      expect(html, entry.file).not.toMatch(/<script[^>]*\ssrc\s*=/i);
      expect(html, entry.file).not.toMatch(/<link[^>]*\shref\s*=/i);
      expect(html, entry.file).not.toMatch(/@import/i);
      expect(html, entry.file).not.toMatch(/url\(\s*["']?(https?:)?\/\//i);
      expect(html, entry.file).toMatch(/url\(["']?data:font\/woff2/);
    }
  });

  it("each HTML carries the exact CSP meta before any style or script", () => {
    for (const entry of Object.values(manifest.widgets)) {
      const html = readFileSync(join(uiDir, entry.file), "utf8");
      expect(html, entry.file).toContain(`<meta http-equiv="Content-Security-Policy" content="${CSP}">`);
      expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("<style"));
      expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("<script"));
    }
  });

  it("is deterministic: rebuilding unchanged sources keeps every hash", () => {
    const before = JSON.stringify(manifest);
    build();
    expect(JSON.stringify(readManifest())).toBe(before);
  }, 300_000);
});
