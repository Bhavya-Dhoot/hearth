/**
 * Screenshots every widget x device x theme into packages/widgets/.screens/ and asserts the bridge sequence:
 *   ui/ready -> ui/hostContext -> ui/render -> ui/resize, then a tap -> ui/action round trip.
 * Every message a widget posts is also validated against the frozen WidgetToHost contract.
 *
 * On every fixed frame (Show 8 at the host's 1280 x 680, Show 15 contract and tile) it also asserts that the widget's natural
 * height fits hostContext.maxHeight, so the host never has to scale it down.
 *
 * Usage: tsx scripts/screens.ts [--only step-card] [--device phone|echo-show-8|echo-show-15|echo-show-15-tile] [--theme light] [--no-shots]
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
  /** Worst-case content, checked on the fixed frames only: the bridge has to trim it to fit. */
  stress?: boolean;
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

const THEMES = ["dark", "light"] as const;

interface Target {
  name: string;
  device: DeviceClass;
  /** Overrides the contract's frame (the host-sim gives a Show 8 widget 1280 x 680 and a Show 15 tile 1184 x 952). */
  size?: { maxWidth: number; maxHeight: number };
  themes?: readonly (typeof THEMES)[number][];
}

const W = WIDGET_SAMPLES;

/** More and longer content than the samples carry, up to what the contracts allow. Every fixed frame must still hold it at full scale. */
const STRESS: Case[] = [
  {
    widget: "weekend-list",
    variant: "six",
    stress: true,
    props: {
      ...W["weekend-list"],
      tasks: [...W["weekend-list"].tasks, { id: "task_sump", title: "Test the sump pump before the rain", why: "Pour a bucket into the pit and watch it cycle. It has not run since spring.", dueState: "seasonal", minutes: 15, assetName: "Sump pump" }],
    },
  },
  {
    widget: "timeline-list",
    variant: "eight",
    stress: true,
    props: {
      ...W["timeline-list"],
      events: [
        ...W["timeline-list"].events,
        { eventId: "evt_0090", ts: "2020-09-02T09:00:00-05:00", type: "maintenance", summary: "Flushed the water heater and replaced the anode rod. Sediment was light.", assetName: "Rheem water heater" },
        { eventId: "evt_0071", ts: "2019-04-11T14:00:00-05:00", type: "order", summary: "Ordered a MERV 11 furnace filter, 16x25x1, six pack.", assetName: "Carrier furnace", cost: 61.5 },
        { eventId: "evt_0010", ts: "2018-01-20T08:00:00-06:00", type: "added_asset", summary: "Added the Carrier furnace, installed in 2004, with its filter size.", assetName: "Carrier furnace" },
      ],
    },
  },
  {
    widget: "parts-carousel",
    variant: "five",
    stress: true,
    props: {
      ...W["parts-carousel"],
      items: [
        ...W["parts-carousel"].items,
        { ...W["parts-carousel"].items[0]!, sku: "HR-PT-150-BRS", name: "Brass slip-joint washer set, 1-1/2 in, 8 pack with two spare nuts", price: 18.99, fitReason: "Brass lasts longest, but it needs a wrench to seat and your trap is plastic, so it may crack the threads if over-tightened.", badge: "COMPATIBLE" },
        { ...W["parts-carousel"].items[1]!, sku: "HR-PT-150-TAP", name: "Trap arm tape", price: 3.19, badge: "COMPATIBLE" },
      ],
    },
  },
  {
    widget: "recall-card",
    variant: "two",
    stress: true,
    props: {
      ...W["recall-card"],
      flagged: [
        ...W["recall-card"].flagged,
        { ...W["recall-card"].flagged[0]!, assetId: "asset_furnace", assetName: "Furnace", brand: "Carrier", model: "58STA090", recallId: "SAMPLE-2026-0233", title: "Inducer motor bearing can seize", hazard: "A seized inducer can trip the limit switch and leave the house without heat in a cold snap.", remedy: ["Switch the thermostat to off.", "Book the free motor swap through the maker."] },
      ],
    },
  },
  {
    widget: "pro-brief-card",
    variant: "long",
    stress: true,
    props: {
      ...W["pro-brief-card"],
      headline: "Garbage disposal leaking from the unit body and the dishwasher drain hose",
      symptom: "Water pools under the disposal itself while it runs, and again a few minutes after it stops. The pipes and the trap above it are dry.",
      timeline: [
        { ts: "Sat Oct 17, 9:10 AM", text: "Noticed a musty smell in the cabinet." },
        { ts: "Sun Oct 18, 6:30 PM", text: "Found a small puddle in the back left corner." },
        ...W["pro-brief-card"].timeline,
        { ts: "Tue Oct 20, 9:30 PM", text: "Dry paper towel under the disposal soaked in ten minutes of running water." },
      ],
      attempted: [...W["pro-brief-card"].attempted, "Tightened the dishwasher drain clamp", "Checked the sink flange putty"],
      accessNotes: "Under the kitchen sink, left cabinet door. Shut-off valves on the back wall. Main water shut-off is in the garage, left of the electrical panel. Dog in the house, friendly.",
    },
  },
  {
    widget: "home-card",
    variant: "full",
    stress: true,
    props: {
      ...W["home-card"],
      keyLocations: [
        ...W["home-card"].keyLocations,
        { assetId: "asset_gas", label: "Gas shut-off", location: "Side of the house, by the meter" },
        { assetId: "asset_attic", label: "Attic access hatch", location: "Hallway ceiling, upstairs" },
      ],
      openIssues: [...W["home-card"].openIssues, { issueRecordId: "iss_gutter", title: "Gutter sagging at the back corner", status: "open" }],
    },
  },
];

const TARGETS: Target[] = [
  { name: "echo-show-8", device: "echo-show-8", size: { maxWidth: 1280, maxHeight: 680 } },
  { name: "echo-show-15", device: "echo-show-15" },
  { name: "echo-show-15-tile", device: "echo-show-15", size: { maxWidth: 1184, maxHeight: 952 }, themes: ["dark"] },
  { name: "phone", device: "phone" },
];

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
  const heights: string[] = [];
  const fail = (label: string, message: string): void => {
    failures++;
    console.error(`FAIL ${label}: ${message}`);
  };

  for (const kase of [...CASES, ...STRESS]) {
    if (onlyWidget && kase.widget !== onlyWidget) continue;
    const entry = manifest.widgets[kase.widget];
    if (!entry) {
      fail(kase.widget, "missing from manifest");
      continue;
    }
    const html = readFileSync(join(root, "dist", "ui", entry.file), "utf8");
    for (const target of TARGETS) {
      const device = target.device;
      if (onlyDevice && onlyDevice !== target.name) continue;
      if (kase.stress && target.device === "phone") continue;
      for (const theme of target.themes ?? THEMES) {
        if (onlyTheme && theme !== onlyTheme) continue;
        const label = `${kase.widget}${kase.variant ? `:${kase.variant}` : ""} ${target.name} ${theme}`;
        const host: HostContext = { ...DEVICE_CONTEXTS[device], theme, ...target.size };
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
        // A fixed frame must hold the widget at full scale: the host scales a taller one down, which breaks the 10-foot test.
        const fixedFrame = device !== "phone";
        if (fixedFrame && height > host.maxHeight) fail(label, `natural height ${height} exceeds maxHeight ${host.maxHeight}`);
        if (consoleErrors.length > 0) fail(label, `console errors: ${consoleErrors.slice(0, 2).join(" | ")}`);

        if (!noShots) {
          const name = `${kase.widget}${kase.variant ? `-${kase.variant}` : ""}-${target.name}-${theme}.png`;
          await page.locator("iframe").screenshot({ path: join(shotsDir, name) });
          console.log(`shot ${name} (${host.maxWidth}x${height})`);
        }
        if (target.name === "echo-show-8") {
          // The content's own height, without the min-height that stretches a fullscreen frame to maxHeight.
          const content = await page.frameLocator("iframe").locator("#app").evaluate((node) => {
            const el = node as HTMLElement;
            el.style.minHeight = "0px";
            return Math.ceil(el.getBoundingClientRect().height);
          });
          if (content > host.maxHeight) fail(label, `content height ${content} exceeds maxHeight ${host.maxHeight}`);
          heights.push(`${kase.widget}${kase.variant ? `:${kase.variant}` : ""}/${theme}=${content}`);
        }
        // Tap round trip, only once per widget on the Show 8 dark run to keep the matrix quick.
        if (kase.tap && target.name === "echo-show-8" && theme === "dark") {
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

  // The frame changing under a mounted widget: density and the amount shown follow hostContext.maxHeight, in both directions.
  if (!onlyWidget || onlyWidget === "pro-brief-card") {
    const entry = manifest.widgets["pro-brief-card"];
    if (entry) {
      const html = readFileSync(join(root, "dist", "ui", entry.file), "utf8");
      const show8: HostContext = { ...DEVICE_CONTEXTS["echo-show-8"], maxHeight: 680 };
      const context = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
      const page = await context.newPage();
      await mountHost(page, html, show8, WIDGET_SAMPLES["pro-brief-card"]);
      await page.waitForFunction(() => (window as unknown as { __log: LogEntry[] }).__log.some((e) => e.data.type === "ui/resize"), null, { timeout: 8000 }).catch(() => undefined);
      await page.waitForTimeout(600);
      const frame = page.frameLocator("iframe");
      const probe = async (): Promise<{ density: string | undefined; photos: number; height: number }> => {
        const state = await frame.locator("body").evaluate(() => ({ density: document.documentElement.dataset["density"], photos: document.querySelectorAll(".photos__item").length }));
        const sizes = (await logOf(page)).filter((e) => e.data.type === "ui/resize");
        return { ...state, height: Number(sizes[sizes.length - 1]?.data["height"] ?? 0) };
      };
      const send = async (ctx: HostContext): Promise<void> => {
        await page.evaluate((c) => document.querySelector("iframe")?.contentWindow?.postMessage({ type: "ui/hostContext", payload: c }, "*"), ctx);
        await page.waitForTimeout(500);
      };
      const label = "pro-brief-card hostContext change";
      checked++;
      const before = await probe();
      await send({ ...show8, maxHeight: 1400 });
      const roomy = await probe();
      await send(show8);
      const after = await probe();
      if (before.density !== "tight" || before.photos !== 0 || before.height > 680) fail(label, `Show 8 start ${JSON.stringify(before)}`);
      else if (roomy.density !== "roomy" || roomy.photos === 0) fail(label, `taller frame ${JSON.stringify(roomy)}`);
      else if (after.density !== "tight" || after.photos !== 0 || after.height > 680) fail(label, `back to Show 8 ${JSON.stringify(after)}`);
      else console.log(`ok   ${label}: ${JSON.stringify({ before, roomy, after })}`);
      await context.close();
    }
  }

  await browser.close();
  if (heights.length > 0) console.log(`show8 natural heights (max 680): ${heights.join("; ")}`);
  console.log(`screens: ${checked} renders checked, ${failures} failures`);
  if (failures > 0) process.exit(1);
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
