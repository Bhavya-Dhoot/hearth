import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { WIDGET_PATTERN, WidgetName, type UiPattern } from "@hearth/contracts";
import { z } from "zod";
import type { Logger } from "../log";

const ManifestFile = z.object({
  widgets: z.record(z.string(), z.object({ file: z.string(), uri: z.string().startsWith("ui://hearth/"), hash: z.string(), bytes: z.number() })),
});

export interface WidgetEntry {
  name: WidgetName;
  file: string;
  uri: string;
  hash: string;
  bytes: number;
  pattern: UiPattern;
}

const RECHECK_MS = 1000;

/**
 * Widget bundles built by @hearth/widgets (dist/ui/manifest.json plus one HTML file each).
 * The manifest is re-read when it changes, so a rebuild shows up without restarting the server.
 * File names are content hashed, so each HTML file is cached for the life of the process.
 */
export class WidgetStore {
  private entriesCache: WidgetEntry[] = [];
  private mtime = -1;
  private checkedAt = -Infinity;
  private warned = false;
  private readonly html = new Map<string, string>();

  constructor(
    private readonly dir: string,
    private readonly logger: Logger,
  ) {
    this.refresh(true);
  }

  private refresh(force = false): void {
    const now = performance.now();
    if (!force && now - this.checkedAt < RECHECK_MS) return;
    this.checkedAt = now;
    const manifestPath = path.join(this.dir, "manifest.json");
    let mtime: number;
    try {
      mtime = statSync(manifestPath).mtimeMs;
    } catch {
      this.entriesCache = [];
      this.mtime = -1;
      if (!this.warned) {
        this.warned = true;
        this.logger.warn("widget_manifest_missing", { path: manifestPath, hint: "Run `pnpm --filter @hearth/widgets build`. Visual tools will return text and structured content only." });
      }
      return;
    }
    if (mtime === this.mtime) return;
    try {
      const manifest = ManifestFile.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
      const entries: WidgetEntry[] = [];
      for (const [key, value] of Object.entries(manifest.widgets)) {
        const name = WidgetName.safeParse(key);
        if (!name.success) continue;
        entries.push({ name: name.data, ...value, pattern: WIDGET_PATTERN[name.data] });
      }
      this.entriesCache = entries;
      this.mtime = mtime;
      this.warned = false;
      this.logger.info("widget_manifest_loaded", { widgets: entries.length });
    } catch (err) {
      this.entriesCache = [];
      this.logger.error("widget_manifest_invalid", { path: manifestPath, message: err instanceof Error ? err.message : String(err) });
    }
  }

  entries(): WidgetEntry[] {
    this.refresh();
    return this.entriesCache;
  }

  byName(name: WidgetName): WidgetEntry | undefined {
    return this.entries().find((e) => e.name === name);
  }

  byUri(uri: string): WidgetEntry | undefined {
    return this.entries().find((e) => e.uri === uri);
  }

  htmlFor(entry: WidgetEntry): string {
    const cached = this.html.get(entry.file);
    if (cached !== undefined) return cached;
    // The file name comes from our own manifest; reject anything that could leave the widgets directory.
    const resolved = path.resolve(this.dir, entry.file);
    if (path.dirname(resolved) !== path.resolve(this.dir)) throw new Error(`widget file escapes the widgets directory: ${entry.file}`);
    const text = readFileSync(resolved, "utf8");
    this.html.set(entry.file, text);
    return text;
  }
}
