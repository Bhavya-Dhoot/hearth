/**
 * Screenshots every widget x device x theme into packages/widgets/.screens/ and asserts the bridge sequence:
 *   ui/ready -> ui/hostContext -> ui/render -> ui/resize, then a tap -> ui/action round trip.
 * Every message a widget posts is also validated against the frozen WidgetToHost contract.
 *
 * Usage: tsx scripts/screens.ts [--only step-card] [--device phone] [--theme light] [--no-shots]
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEVICE_CONTEXTS, WidgetToHost, type DeviceClass, type HostContext, type WidgetName } from "@hearth/contracts";
import { chromium, type Browser, type Page } from "playwright";
import { WIDGET_SAMPLES, WIDGET_SAMPLES_EXTRA } from "../src/samples";
import type { Manifest } from "../src/manifest";
import { buildAll } from "./build";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shotsDir = join(root, ".screens");
const mediaDir = join(root, "media");
const manifestPath = join(root, "dist", "ui", "manifest.json");

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const onlyWidget = flag("only");
const onlyDevice = flag("device");
const onlyTheme = flag("theme");
const noShots = args.includes("--no-shots");

interface Case {
  widget: WidgetName;
  variant: string;
  props: unknown;
  /** Selector inside the widget to tap, and the action name it must post. */
  tap?: { selector: string; action: string };
}

const CASES: Case[] = [
  { widget: "step-card", variant: "", props: WIDGET_SAMPLES["step-card"], tap: { selector: "[data-voice=next]", action: "next_step" } },
  { widget: "step-card", variant: "final", props: WIDGET_SAMPLES_EXTRA["step-card"].final, tap: { selector: "[data-voice=next]", action: "done" } },
  { widget: "parts-carousel", variant: "", props: WIDGET_SAMPLES["parts-carousel"], tap: { selector: "[data-voice-index='1']", action: "select_part" } },
  { widget: "checkout-card", variant: "checkout", props: WIDGET_SAMPLES_EXTRA["checkout-card"].checkout, tap: { selector: "[data-voice=confirm]", action: "confirm_checkout" } },
  { widget: "checkout-card", variant: "confirmation", props: WIDGET_SAMPLES_EXTRA["checkout-card"].confirmation },
  { widget: "weekend-list", variant: "", props: WIDGET_SAMPLES["weekend-list"], tap: { selector: "[data-reorder]", action: "reorder" } },
  { widget: "pro-brief-card", variant: "", props: WIDGET_SAMPLES["pro-brief-card"], tap: { selector: "[data-find-pro]", action: "find_pro" } },
  { widget: "home-card", variant: "", props: WIDGET_SAMPLES["home-card"] },
  { widget: "timeline-list", variant: "", props: WIDGET_SAMPLES["timeline-list"], tap: { selector: "[data-voice-index='0']", action: "open_event" } },
  { widget: "recall-card", variant: "", props: WIDGET_SAMPLES["recall-card"] },
  { widget: "recall-card", variant: "empty", props: WIDGET_SAMPLES_EXTRA["recall-card"].empty },
];

const DEVICES: DeviceClass[] = ["echo-show-8", "echo-show-15", "phone"];
const THEMES = ["dark", "light"] as const;

interface LogEntry {
  dir: "in" | "out";
  data: { type: string; [key: string]: unknown };
}

function launchOptions(): { executablePath?: string } {
  const base = join(process.env["LOCALAPPDATA"] ?? "", "ms-playwright");
  if (!existsSync(base)) return {};
  const expected = chromium.executablePath();
  if (existsSync(expected)) return {};
  for (const dir of readdirSync(base).filter((d) => d.startsWith("chromium-")).sort().reverse()) {
    for (const sub of ["chrome-win64", "chrome-win"]) {
      const exe = join(base, dir, sub, "chrome.exe");
      if (existsSync(exe)) return { executablePath: exe };
    }
  }
  return {};
}

/** Host side of the bridge as plain script text (evaluated in the page; the preview harness has the full TypeScript version). */
const HOST_SCRIPT = `(function (doc, ctx, payload) {
  var log = [];
  window.__log = log;
  var frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.style.cssText = "border:0;display:block;width:" + ctx.maxWidth + "px;height:" + ctx.maxHeight + "px";
  window.addEventListener("message", function (event) {
    if (event.source !== frame.contentWindow) return;
    var data = event.data;
    log.push({ dir: "out", data: data });
    if (data.type === "ui/ready") {
      [{ type: "ui/hostContext", payload: ctx }, { type: "ui/render", props: payload }].forEach(function (msg) {
        log.push({ dir: "in", data: msg });
        frame.contentWindow.postMessage(msg, "*");
      });
    }
    if (data.type === "ui/resize" && typeof data.height === "number") frame.style.height = Math.max(data.height, 1) + "px";
  });
  frame.srcdoc = doc;
  document.body.appendChild(frame);
})`;

async function mountHost(page: Page, html: string, host: HostContext, props: unknown): Promise<void> {
  await page.setContent('<!doctype html><html><body style="margin:0;background:#888"></body></html>');
  await page.evaluate(`${HOST_SCRIPT}(${JSON.stringify(html)}, ${JSON.stringify(host)}, ${JSON.stringify(props)})`);
}

const logOf = (page: Page): Promise<LogEntry[]> => page.evaluate(() => (window as unknown as { __log: LogEntry[] }).__log);

async function run(): Promise<void> {
  let manifest: Manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  } catch {
    manifest = await buildAll();
  }
  if (!noShots) {
    if (!onlyWidget && !onlyDevice && !onlyTheme) rmSync(shotsDir, { recursive: true, force: true });
    mkdirSync(shotsDir, { recursive: true });
  }

  const browser: Browser = await chromium.launch(launchOptions());
  let failures = 0;
  let checked = 0;
  const fail = (label: string, message: string): void => {
    failures++;
    console.error(`FAIL ${label}: ${message}`);
  };

  for (const kase of CASES) {
    if (onlyWidget && kase.widget !== onlyWidget) continue;
    const entry = manifest.widgets[kase.widget];
    if (!entry) {
      fail(kase.widget, "missing from manifest");
      continue;
    }
    const html = readFileSync(join(root, "dist", "ui", entry.file), "utf8");
    for (const device of DEVICES) {
      if (onlyDevice && device !== onlyDevice) continue;
      for (const theme of THEMES) {
        if (onlyTheme && theme !== onlyTheme) continue;
        const label = `${kase.widget}${kase.variant ? `:${kase.variant}` : ""} ${device} ${theme}`;
        const host: HostContext = { ...DEVICE_CONTEXTS[device], theme };
        const context = await browser.newContext({ viewport: { width: Math.max(host.maxWidth, 320), height: Math.max(host.maxHeight, 600) }, deviceScaleFactor: 1 });
        const page = await context.newPage();
        const consoleErrors: string[] = [];
        page.on("pageerror", (error) => consoleErrors.push(error.message));
        page.on("console", (message) => {
          if (message.type() === "error") consoleErrors.push(message.text());
        });
        await page.route("http://localhost:4200/media/**", async (route) => {
          const file = join(mediaDir, route.request().url().split("/media/")[1] ?? "");
          if (existsSync(file)) await route.fulfill({ status: 200, contentType: "image/svg+xml", body: readFileSync(file) });
          else await route.fulfill({ status: 404, body: "not found" });
        });

        await mountHost(page, html, host, kase.props);
        await page.waitForFunction(() => (window as unknown as { __log: LogEntry[] }).__log.some((e) => e.data.type === "ui/resize"), null, { timeout: 8000 }).catch(() => undefined);
        await page.waitForTimeout(900);

        // Bridge order: ready, then (host) hostContext + render, then resize.
        const log = await logOf(page);
        const types = log.map((e) => e.data.type);
        const order = ["ui/ready", "ui/hostContext", "ui/render", "ui/resize"].map((t) => types.indexOf(t));
        checked++;
        if (order.some((i) => i < 0) || order.some((v, i) => i > 0 && v < (order[i - 1] ?? -1))) fail(label, `bridge order wrong: ${types.join(" > ")}`);
        for (const entryLog of log.filter((e) => e.dir === "out")) {
          const parsed = WidgetToHost.safeParse(entryLog.data);
          if (!parsed.success) fail(label, `invalid widget message ${JSON.stringify(entryLog.data)}`);
          if (entryLog.data.type === "ui/error") fail(label, `ui/error ${String(entryLog.data["message"])}`);
        }
        const resize = [...log].reverse().find((e) => e.data.type === "ui/resize");
        const height = typeof resize?.data["height"] === "number" ? resize.data["height"] : 0;
        if (height < 80) fail(label, `implausible resize height ${height}`);
        if (consoleErrors.length > 0) fail(label, `console errors: ${consoleErrors.slice(0, 2).join(" | ")}`);

        if (!noShots) {
          const name = `${kase.widget}${kase.variant ? `-${kase.variant}` : ""}-${device}-${theme}.png`;
          await page.locator("iframe").screenshot({ path: join(shotsDir, name) });
          console.log(`shot ${name} (${host.maxWidth}x${height})`);
        }
        // Tap round trip, only once per widget on the Show 8 dark run to keep the matrix quick.
        if (kase.tap && device === "echo-show-8" && theme === "dark") {
          const frame = page.frameLocator("iframe");
          const target = frame.locator(kase.tap.selector).first();
          if ((await target.count()) === 0) fail(label, `tap target ${kase.tap.selector} not found`);
          else {
            await target.click();
            await page.waitForTimeout(150);
            const after = await logOf(page);
            const action = after.filter((e) => e.dir === "out" && e.data.type === "ui/action").map((e) => (e.data["action"] as { name?: string } | undefined)?.name);
            if (!action.includes(kase.tap.action)) fail(label, `expected ui/action ${kase.tap.action}, got ${JSON.stringify(action)}`);
            else console.log(`ok   ${label}: tap ${kase.tap.selector} -> ${kase.tap.action}`);
          }
        }

        await context.close();
      }
    }
  }

  // Annotation stroke: animated (<= 420ms) by default, drawn statically under prefers-reduced-motion.
  if (!onlyWidget || onlyWidget === "step-card") {
    const entry = manifest.widgets["step-card"];
    if (entry) {
      const html = readFileSync(join(root, "dist", "ui", entry.file), "utf8");
      for (const reduce of [false, true]) {
        const label = `step-card annotation ${reduce ? "reduced-motion" : "motion"}`;
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: reduce ? "reduce" : "no-preference" });
        const page = await context.newPage();
        await page.route("http://localhost:4200/media/**", async (route) => {
          const file = join(mediaDir, route.request().url().split("/media/")[1] ?? "");
          if (existsSync(file)) await route.fulfill({ status: 200, contentType: "image/svg+xml", body: readFileSync(file) });
          else await route.fulfill({ status: 404, body: "not found" });
        });
        await mountHost(page, html, DEVICE_CONTEXTS["echo-show-8"], WIDGET_SAMPLES["step-card"]);
        const stroke = page.frameLocator("iframe").locator(".annotation__stroke.annotation__circle");
        await stroke.waitFor({ state: "attached", timeout: 8000 }).catch(() => undefined);
        await page.waitForTimeout(800);
        const style = await stroke.evaluate((node) => {
          const cs = getComputedStyle(node);
          return { animation: cs.animationName, duration: cs.animationDuration, offset: cs.strokeDashoffset, width: cs.strokeWidth };
        }).catch(() => null);
        checked++;
        if (!style) fail(label, "annotation stroke not found");
        else if (reduce && (style.animation !== "none" || Number.parseFloat(style.offset) !== 0)) fail(label, `expected a static stroke, got ${JSON.stringify(style)}`);
        else if (!reduce && (style.animation === "none" || Number.parseFloat(style.duration) > 0.42)) fail(label, `expected a <= 420ms draw, got ${JSON.stringify(style)}`);
        else console.log(`ok   ${label}: ${JSON.stringify(style)}`);
        await context.close();
      }
    }
  }

  await browser.close();
  console.log(`screens: ${checked} renders checked, ${failures} failures`);
  if (failures > 0) process.exit(1);
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
