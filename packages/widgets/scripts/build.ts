import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WidgetName } from "@hearth/contracts";
import { cssText } from "@hearth/design-tokens";
import { build } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import type { Manifest } from "../src/manifest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entryDir = join(root, ".build");
const stageDir = join(root, ".build-out");
const outDir = join(root, "dist", "ui");

export const CSP =
  "default-src 'none'; img-src 'self' data: http: https:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:";

const TITLES: Record<WidgetName, string> = {
  "step-card": "Hearth step card",
  "parts-carousel": "Hearth parts carousel",
  "checkout-card": "Hearth checkout card",
  "weekend-list": "Hearth weekend list",
  "pro-brief-card": "Hearth pro brief card",
  "home-card": "Hearth home card",
  "timeline-list": "Hearth timeline list",
  "recall-card": "Hearth recall card",
};

function entryHtml(name: WidgetName): string {
  return `<!doctype html>
<html lang="en" data-theme="dark" data-device="echo-show-8">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${TITLES[name]}</title>
<link rel="stylesheet" href="./tokens.css">
</head>
<body>
<div id="app" aria-live="polite"></div>
<script type="module" src="/src/widgets/${name}.ts"></script>
</body>
</html>
`;
}

async function buildOne(name: WidgetName): Promise<string> {
  const entry = join(entryDir, `${name}.html`);
  writeFileSync(entry, entryHtml(name), "utf8");
  await build({
    root,
    configFile: false,
    logLevel: "warn",
    plugins: [viteSingleFile()],
    build: {
      outDir: stageDir,
      emptyOutDir: false,
      target: "es2022",
      minify: true,
      cssMinify: true,
      reportCompressedSize: false,
      rollupOptions: { input: entry },
    },
  });
  return readFileSync(join(stageDir, ".build", `${name}.html`), "utf8");
}

/** Builds every widget into dist/ui/<name>-<hash6>.html plus manifest.json. Returns the manifest. */
export async function buildAll(names: readonly WidgetName[] = WidgetName.options): Promise<Manifest> {
  rmSync(entryDir, { recursive: true, force: true });
  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(entryDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  if (names.length === WidgetName.options.length) for (const old of readdirSync(outDir)) rmSync(join(outDir, old), { force: true });
  writeFileSync(join(entryDir, "tokens.css"), cssText(), "utf8");

  const manifest: Manifest = { widgets: {} };
  for (const name of names) {
    const html = await buildOne(name);
    const hash = createHash("sha256").update(html).digest("hex").slice(0, 6);
    const file = `${name}-${hash}.html`;
    writeFileSync(join(outDir, file), html, "utf8");
    manifest.widgets[name] = { file, uri: `ui://hearth/${file}`, hash, bytes: Buffer.byteLength(html) };
  }
  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  rmSync(entryDir, { recursive: true, force: true });
  rmSync(stageDir, { recursive: true, force: true });
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const started = Date.now();
  const only = process.env.HEARTH_WIDGETS?.split(",").map((n) => WidgetName.parse(n.trim()));
  buildAll(only)
    .then((manifest) => {
      for (const [name, entry] of Object.entries(manifest.widgets)) console.log(`widgets: ${name.padEnd(15)} ${entry.file} ${(entry.bytes / 1024).toFixed(1)} KB`);
      console.log(`widgets: built ${Object.keys(manifest.widgets).length} in ${((Date.now() - started) / 1000).toFixed(1)}s -> ${outDir}`);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
