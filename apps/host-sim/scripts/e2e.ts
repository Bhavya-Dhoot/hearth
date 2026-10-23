/**
 * Browser E2E for the simulated Alexa+ host. Drives the real stack (auth server, MCP server, host-sim) in headless
 * Chromium: the OAuth link flow through the auth server's own page, then the five demo replays J1..J5, the 401 probe,
 * device switching, and the legal pages. Screenshots land in apps/host-sim/.screens/e2e/ (gitignored).
 *
 * Run (stack must already be up on 3000 / 4410 / 4420):
 *   pnpm --filter @hearth/widgets exec tsx ../../apps/host-sim/scripts/e2e.ts
 * Env: E2E_BASE (default http://localhost:3000), E2E_ONLY (comma list, e.g. J1,J3), E2E_EMAIL, E2E_PASSWORD.
 */
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { REPLAYS, type ReplayId } from "@hearth/host-sim-core";

const here = path.dirname(fileURLToPath(import.meta.url));

const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
// Local dev seed account from apps/auth-server/README.md ("Demo account"); exists nowhere else.
const EMAIL = process.env.E2E_EMAIL ?? "priya@okafor.example";
const PASSWORD = process.env.E2E_PASSWORD ?? "okafor-demo-2026";
const OUT = path.resolve(here, "../.screens/e2e");
const ONLY = (process.env.E2E_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const IDS = (Object.keys(REPLAYS) as ReplayId[]).filter((id) => ONLY.length === 0 || ONLY.includes(id));
const REPLAY_TIMEOUT_MS = 6 * 60_000;

const failures: string[] = [];
const results: string[] = [];
const warnings: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fail = (m: string) => {
  if (failures.includes(m)) return;
  failures.push(m);
  console.error(`  FAIL ${m}`);
};
const check = (cond: unknown, m: string) => {
  if (!cond) fail(m);
};

const inspector = (p: Page) => p.locator('aside[aria-label="Protocol inspector"]');

async function toolsLine(p: Page): Promise<string> {
  return (await inspector(p).locator('dl > div:has(> dt:text-is("Tools")) dd').first().textContent({ timeout: 2000 }).catch(() => "")) ?? "";
}
async function toolsCalled(p: Page): Promise<number> {
  const m = /(\d+) called/.exec(await toolsLine(p));
  return m ? Number(m[1]) : 0;
}
async function failedRows(p: Page): Promise<number> {
  return inspector(p).locator("li[data-failed]").count();
}
async function replayLine(p: Page): Promise<{ state: string; text: string } | null> {
  const el = inspector(p).locator("p[data-state]").first();
  if ((await el.count()) === 0) return null;
  return { state: (await el.getAttribute("data-state")) ?? "", text: ((await el.textContent()) ?? "").replace(/\s+/g, " ").trim() };
}
async function widgetSignature(p: Page): Promise<string | null> {
  const iframe = p.locator("iframe[data-widget]").first();
  if ((await iframe.count()) === 0) return null;
  const name = (await iframe.getAttribute("data-widget")) ?? "?";
  const frame = iframe.contentFrame();
  const text = await frame.locator("body").innerText({ timeout: 1500 }).catch(() => "");
  return `${name}|${text.replace(/\s+/g, " ").slice(0, 400)}`;
}

let shotNo = 0;
async function shoot(p: Page, name: string): Promise<string> {
  const file = `${String(++shotNo).padStart(3, "0")}-${name}`;
  await p.screenshot({ path: path.join(OUT, `${file}.png`) });
  const screen = p.locator("div[data-widget][data-device]").first();
  if ((await screen.count()) > 0) await screen.screenshot({ path: path.join(OUT, `${file}-screen.png`) }).catch(() => undefined);
  return file;
}

async function linkAccount(p: Page) {
  console.log("link flow");
  await p.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  const linkBtn = p.getByRole("button", { name: "Link Hearth account" });
  await linkBtn.waitFor({ timeout: 20_000 });
  await shoot(p, "unlinked");
  await linkBtn.click();
  await p.waitForURL(/localhost:4410/, { timeout: 20_000 });
  await p.locator("#email").waitFor();
  await shoot(p, "auth-page");
  await p.locator("#email").fill(EMAIL);
  await p.locator("#password").fill(PASSWORD);
  await p.getByRole("button", { name: "Link account" }).click();
  await p.waitForURL((u) => u.origin === new URL(BASE).origin, { timeout: 30_000 });
  await p.locator('[data-link="linked"]').first().waitFor({ timeout: 30_000 });
  await p.getByText("Hearth is ready", { exact: false }).first().waitFor({ timeout: 30_000 });
  await inspector(p).locator("li").first().waitFor({ timeout: 20_000 }).catch(() => undefined);
  const sug = await p.locator('section[aria-label="Things to ask"]').count();
  check(sug === 1, `idle linked screen should show the suggestions panel once (saw ${sug})`);
  await shoot(p, "linked-idle");
  console.log("  linked");
}

async function runReplay(p: Page, id: ReplayId) {
  const expected = REPLAYS[id].expectTools.length;
  const turns = REPLAYS[id].turns.length;
  console.log(`${id}: ${REPLAYS[id].title} (${turns} turns, expect ${expected} tools)`);
  await p.goto(`${BASE}/?replay=${id}`, { waitUntil: "domcontentloaded" });

  const started = Date.now();
  let lastSig: string | null = null;
  let widgetShots = 0;
  let sawRunning = false;
  let sawFinalTurn = false;
  let finished: { state: string; text: string } | null = null;
  let stableSince = 0;
  let lastCount = -1;
  let switched = false;

  while (Date.now() - started < REPLAY_TIMEOUT_MS) {
    await sleep(450);
    const rl = await replayLine(p);
    if (rl?.state === "running") {
      sawRunning = true;
      if (new RegExp(`${id} turn ${turns} of ${turns}`).test(rl.text)) sawFinalTurn = true;
    }

    const sig = await widgetSignature(p);
    if (sig && sig !== lastSig) {
      await sleep(900); // let the annotation stroke (420ms) and entrance settle
      const again = await widgetSignature(p);
      const widgetName = (sig.split("|")[0] ?? "widget").replace(/[^a-z0-9-]/gi, "");
      await shoot(p, `${id}-${String(++widgetShots).padStart(2, "0")}-${widgetName}`);
      lastSig = again ?? sig;
      const scale = await p.locator("iframe[data-widget]").first().getAttribute("data-scale");
      if (scale && Number(scale) < 0.9) warnings.push(`${id} ${widgetName} is scaled to ${scale} to fit its screen (nothing cropped, type shrinks)`);
      if (id === "J3" && !switched && widgetName === "weekend-list") {
        switched = true;
        await deviceSwitching(p);
      }
    }

    // The suggestions must never sit beside an active conversation or a widget.
    if (sig || (rl && rl.state !== "stopped")) {
      const sug = await p.locator('section[aria-label="Things to ask"]').count();
      if (sug > 0) fail(`${id}: "Try asking" panel is on screen during an active replay`);
    }

    const bad = await failedRows(p);
    if (bad > 0) {
      fail(`${id}: ${bad} hazard error row(s) in the inspector`);
      await shoot(p, `${id}-error-rows`);
      break;
    }

    if (rl && (rl.state === "done" || rl.state === "failed" || rl.state === "stopped")) {
      const count = await toolsCalled(p);
      if (count !== lastCount) {
        lastCount = count;
        stableSince = Date.now();
      } else if (Date.now() - stableSince > 1500) {
        finished = rl;
        break;
      }
    }
  }

  if (!finished) {
    fail(`${id}: replay did not finish within ${REPLAY_TIMEOUT_MS / 1000}s (last: ${(await replayLine(p))?.text ?? "no replay line"})`);
    await shoot(p, `${id}-timeout`);
    results.push(`${id}: TIMEOUT`);
    return;
  }
  const count = await toolsCalled(p);
  await shoot(p, `${id}-end`);
  check(sawRunning, `${id}: never saw the "${id} turn N of ${turns}" running line`);
  // J3 spends several seconds in the device-switching block mid-replay, so the final-turn line can pass unseen there.
  if (id !== "J3") check(sawFinalTurn, `${id}: never saw "${id} turn ${turns} of ${turns}"`);
  check(finished.state === "done", `${id}: replay ended ${finished.state}: ${finished.text}`);
  check(count === expected, `${id}: tools called ${count}, expected ${expected}`);
  check(/sequence matches/.test(finished.text), `${id}: inspector did not report a matching sequence: ${finished.text}`);
  check((await failedRows(p)) === 0, `${id}: hazard error rows present at end`);
  check(widgetShots > 0 || id === "J5" || id === "J2", `${id}: no widget ever rendered`);
  const ok = failures.every((f) => !f.startsWith(`${id}:`));
  results.push(`${id}: ${ok ? "PASS" : "FAIL"} tools=${count}/${expected} widgetShots=${widgetShots} ${finished.text}`);
}

/** Show 15 -> Show 8 -> Phone (light theme) -> Voice-only (transcript) -> back to Show 15, mid-journey. */
async function deviceSwitching(p: Page) {
  console.log("  device switching during J3");
  const pick = async (name: string) => {
    await p.getByRole("radio", { name }).click();
    await sleep(1600);
  };
  const widgetShows = async (device: string) => {
    const sig = await widgetSignature(p);
    check(!!sig && sig.split("|")[1]!.length > 40, `J3: widget is not visible after switching to ${device} (signature: ${sig?.slice(0, 60) ?? "none"})`);
  };
  const theme = () => p.locator("div[data-widget][data-device]").first().getAttribute("data-theme");

  await pick("Show 8");
  check((await p.locator("div[data-widget][data-device='echo-show-8']").count()) === 1, "J3: Show 8 screen did not render");
  await widgetShows("Show 8");
  await shoot(p, "J3-device-show8");

  await pick("Phone");
  check((await theme()) === "light", "J3: Phone did not switch to the light theme");
  await widgetShows("Phone");
  await shoot(p, "J3-device-phone-light");

  await pick("Voice");
  const transcript = await p.getByText("Transcript", { exact: false }).count();
  check(transcript > 0, "J3: Voice-only did not show the transcript");
  await shoot(p, "J3-device-voice-only");

  await pick("Show 15");
  check((await p.locator("div[data-widget][data-device='echo-show-15']").count()) === 1, "J3: back on Show 15 the screen did not render");
  check((await theme()) === "dark", "J3: Show 15 is not dark");
  await widgetShows("Show 15");
}

async function probe401(p: Page) {
  console.log("401 probe");
  const before = await inspector(p).locator("li[data-failed]").count();
  await inspector(p).getByRole("button", { name: "Send without a token" }).click();
  try {
    await p.waitForFunction(
      (prev) => document.querySelectorAll('aside[aria-label="Protocol inspector"] li[data-failed]').length > prev,
      before,
      { timeout: 15_000 },
    );
  } catch {
    fail("401: no failed row appeared after Send without a token");
  }
  const text = (await inspector(p).locator("li[data-failed]").last().textContent().catch(() => "")) ?? "";
  check(/401/.test(text), `401: failed row does not show 401 (got "${text.replace(/\s+/g, " ").slice(0, 80)}")`);
  await shoot(p, "401-row");
  results.push(`401: ${/401/.test(text) ? "PASS" : "FAIL"}`);
}

/** The inspector must collapse to a slim rail and reopen, leaving the stage intact. */
async function inspectorCollapse(p: Page) {
  console.log("inspector collapse");
  const panel = inspector(p).locator("h2");
  check(await panel.isVisible(), "inspector: panel not visible before collapsing");
  await inspector(p).getByRole("button", { name: "Collapse inspector" }).first().click();
  await sleep(600);
  check(!(await panel.isVisible()), "inspector: panel still visible after collapsing");
  check((await p.getByRole("radiogroup").count()) > 0, "inspector: stage controls gone after collapsing");
  await shoot(p, "inspector-collapsed");
  await inspector(p).getByRole("button", { name: "Expand inspector" }).click();
  await sleep(600);
  check(await panel.isVisible(), "inspector: panel did not reopen");
  results.push("inspector collapse/expand: done");
}

async function legal(p: Page) {
  for (const route of ["/privacy", "/terms"]) {
    const res = await p.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    check(res?.status() === 200, `${route}: HTTP ${res?.status()}`);
    const h1 = await p.locator("h1").first().textContent();
    check(!!h1 && h1.trim().length > 2, `${route}: no h1`);
    const body = (await p.locator("main, body").first().innerText()).length;
    check(body > 400, `${route}: page body is only ${body} characters`);
    await shoot(p, `legal${route.replace("/", "-")}`);
    results.push(`${route}: ${h1?.trim()} (${body} chars)`);
  }
}

async function mobile(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await sleep(1500);
  await p.screenshot({ path: path.join(OUT, "mobile-unlinked.png"), fullPage: true });
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 0, `mobile 390px: horizontal overflow of ${overflow}px`);
  await ctx.close();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(OUT)) rmSync(path.join(OUT, f), { force: true });
  const exe = process.env.E2E_CHROMIUM;
  const browser = await chromium.launch({
    headless: true,
    ...(exe && existsSync(exe) ? { executablePath: exe } : {}),
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => fail(`pageerror: ${e.message.slice(0, 200)}`));
  p.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/401|Failed to load resource/.test(t)) return; // the deliberate 401 probe logs a network error
    warnings.push(t.slice(0, 160));
  });

  try {
    await linkAccount(p);
    for (const id of IDS) await runReplay(p, id);
    if (IDS.includes("J5") || IDS.length > 0) await probe401(p);
    await inspectorCollapse(p);
    await legal(p);
    await mobile(browser);
  } catch (e) {
    fail(`unexpected: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    await shoot(p, "crash").catch(() => undefined);
  } finally {
    await browser.close();
  }

  console.log("\nRESULTS");
  for (const r of results) console.log(`  ${r}`);
  if (warnings.length) console.log(`warnings (not failing): ${[...new Set(warnings)].join(" | ")}`);
  console.log(`screenshots: ${OUT}`);
  if (failures.length) {
    console.error(`\n${failures.length} FAILURE(S)`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nALL GREEN");
}

void main();
