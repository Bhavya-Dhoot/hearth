/**
 * Renders the Hearth store icons (docs/icons/*.png) from docs/icons/icon.svg and writes review
 * thumbnails of every media illustration to packages/widgets/.screens/media/ (gitignored).
 *
 *   pnpm --filter @hearth/widgets exec tsx scripts/render-icons.ts          # icons + review
 *   pnpm --filter @hearth/widgets exec tsx scripts/render-icons.ts icons    # icons only
 *   pnpm --filter @hearth/widgets exec tsx scripts/render-icons.ts review   # review only
 *
 * Review output: <name>.png (600 px wide). HOME_MEDIA files also get <name>.debug.png with a thin
 * red circle at the contract annotation coordinates (never written into the shipped SVGs).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import { HOME_MEDIA } from "@hearth/contracts";

const here = import.meta.dirname;
const mediaDir = resolve(here, "../media");
const iconsDir = resolve(here, "../../../docs/icons");
const screensDir = resolve(here, "../.screens/media");

const ICON_SIZES: Record<string, number> = {
  "108.png": 108,
  "512.png": 512,
  "1024.png": 1024,
  "small.png": 64,
  "medium.png": 128,
  "large.png": 256,
};

async function launch(): Promise<Browser> {
  try {
    return await chromium.launch();
  } catch {
    // Installed chromium revision may differ from the one playwright pins: use whatever build exists.
    const root = join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
    const dirs = existsSync(root) ? readdirSync(root) : [];
    const candidates = [
      ...dirs.filter((d) => d.startsWith("chromium-")).map((d) => join(root, d, "chrome-win64", "chrome.exe")),
      ...dirs.filter((d) => d.startsWith("chromium_headless_shell-")).map((d) => join(root, d, "chrome-win", "headless_shell.exe")),
    ].filter(existsSync);
    if (!candidates.length) throw new Error("No chromium build found in " + root);
    return chromium.launch({ executablePath: candidates[0] });
  }
}

/** Render an SVG string at `width` x `height` CSS px with the given device scale factor. */
async function renderSvg(browser: Browser, svg: string, width: number, height: number, scale: number, out: string) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
  const page = await ctx.newPage();
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:#141210"><div style="width:${width}px;height:${height}px">${svg.replace(
      /<svg /,
      `<svg style="display:block" `,
    ).replace(/width="\d+" height="\d+"/, `width="${width}" height="${height}"`)}</div></body></html>`,
  );
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width, height } });
  await ctx.close();
}

export async function renderIcons(browser: Browser) {
  mkdirSync(iconsDir, { recursive: true });
  const svg = readFileSync(join(iconsDir, "icon.svg"), "utf8");
  for (const [file, size] of Object.entries(ICON_SIZES)) {
    await renderSvg(browser, svg, size, size, 1, join(iconsDir, file));
    console.log("icon", file, `${size}x${size}`);
  }
}

export async function renderReview(browser: Browser) {
  mkdirSync(screensDir, { recursive: true });
  writeFileSync(join(resolve(screensDir, ".."), ".gitignore"), "*\n");
  const files = readdirSync(mediaDir).filter((f) => f.endsWith(".svg")).sort();
  for (const f of files) {
    const svg = readFileSync(join(mediaDir, f), "utf8");
    const m = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
    if (!m) throw new Error(`${f}: no viewBox`);
    const w = Number(m[1]);
    const h = Number(m[2]);
    const tw = 600;
    const th = Math.round((h / w) * tw);
    await renderSvg(browser, svg, tw, th, 1, join(screensDir, f.replace(/\.svg$/, ".png")));
    // Full-resolution version for close inspection of home art (text legibility, alignment).
    const home = HOME_MEDIA[f as keyof typeof HOME_MEDIA];
    if (home) {
      const a = home.annotation;
      const circle = `<circle cx="${a.x * w}" cy="${a.y * h}" r="${a.r * w}" fill="none" stroke="#ff2a2a" stroke-width="2"/><circle cx="${a.x * w}" cy="${a.y * h}" r="3" fill="#ff2a2a"/>`;
      const dbg = svg.replace("</svg>", `${circle}</svg>`);
      await renderSvg(browser, dbg, tw, th, 1, join(screensDir, f.replace(/\.svg$/, ".debug.png")));
      await renderSvg(browser, dbg, w, h, 1, join(screensDir, f.replace(/\.svg$/, ".debug.full.png")));
    }
    console.log("review", f);
  }
}

const mode = process.argv[2] ?? "all";
const browser = await launch();
try {
  if (mode === "all" || mode === "icons") await renderIcons(browser);
  if (mode === "all" || mode === "review") await renderReview(browser);
} finally {
  await browser.close();
}
