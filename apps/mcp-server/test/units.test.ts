import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { silentLogger, redactPath, type Logger } from "../src/log";
import { priceOf, commitmentFor } from "../src/services/checkout";
import { ageInYears, comingWeekend, deliveryDate, isoDateIn, weekendLabel } from "../src/services/dates";
import { createOutboxEmail, createResendEmail, listOutbox, parseEml, readOutboxMessage, type EmailMessage } from "../src/services/email";
import { findSize, plain } from "../src/services/format";
import { gatewayFromEnv, isTestKey } from "../src/services/payments";

const resend = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: resend.send };
  },
}));

describe("dates", () => {
  it("never delivers on a Sunday", () => {
    expect(deliveryDate("2026-10-21", 2)).toBe("2026-10-23");
    expect(deliveryDate("2026-10-24", 1)).toBe("2026-10-26");
    expect(deliveryDate("2026-10-23", 2)).toBe("2026-10-26");
    expect(deliveryDate("2026-10-25", 0)).toBe("2026-10-26");
  });

  it("finds the weekend in progress or coming", () => {
    expect(comingWeekend("2026-10-21")).toEqual({ saturday: "2026-10-24", sunday: "2026-10-25" });
    expect(comingWeekend("2026-10-24")).toEqual({ saturday: "2026-10-24", sunday: "2026-10-25" });
    expect(comingWeekend("2026-10-25")).toEqual({ saturday: "2026-10-24", sunday: "2026-10-25" });
    expect(weekendLabel("2026-10-31", "2026-11-01")).toBe("Oct 31 to Nov 1");
  });

  it("uses the home's time zone for today, and counts whole years", () => {
    expect(isoDateIn(new Date("2026-10-22T02:00:00Z"), "America/Chicago")).toBe("2026-10-21");
    expect(isoDateIn(new Date("2026-10-22T02:00:00Z"), "Not/AZone")).toBe("2026-10-22");
    expect(ageInYears("2017-01-01", "2026-10-21")).toBe(9);
    expect(ageInYears(undefined, "2026-10-21")).toBe(0);
  });
});

describe("pricing and copy", () => {
  it("rounds tax to the cent", () => {
    expect(priceOf(4.29, 1)).toEqual({ subtotal: 4.29, tax: 0.35, shipping: 0, total: 4.64 });
    expect(priceOf(14.99, 3)).toEqual({ subtotal: 44.97, tax: 3.71, shipping: 0, total: 48.68 });
    expect(priceOf(0.99, 7)).toEqual({ subtotal: 6.93, tax: 0.57, shipping: 0, total: 7.5 });
  });

  it("writes the commitment text in the documented format", () => {
    expect(commitmentFor("a widget", 2, 9.99, "2026-10-22", "Visa •••• 4242")).toBe(
      "You're ordering 2× a widget for $9.99, arriving Thursday. Paid with Visa •••• 4242.",
    );
  });

  it("strips long dashes and reads filter sizes either way", () => {
    expect(plain(`a ${String.fromCharCode(0x2014)} b ${String.fromCharCode(0x2013)} c`)).toBe("a - b - c");
    expect(findSize("Furnace filter 16×25×1 MERV 11")).toBe("16x25x1");
    expect(findSize("filter 20 x 25 x 4")).toBe("20x25x4");
    expect(findSize("no size here")).toBeUndefined();
  });

  it("redacts capability tokens from logged paths", () => {
    expect(redactPath("/briefs/abc123secret")).toBe("/briefs/:token");
    expect(redactPath("/receipts/ord_abc")).toBe("/receipts/:orderId");
    expect(redactPath("/mcp")).toBe("/mcp");
  });
});

describe("payments", () => {
  it("accepts only Stripe test keys", () => {
    expect(isTestKey("sk_test_abc")).toBe(true);
    expect(isTestKey("rk_test_abc")).toBe(true);
    expect(isTestKey("sk_live_abc")).toBe(false);
    expect(isTestKey("")).toBe(false);
  });

  it("falls back to simulated payments for no key or a live key, and warns about the live one", () => {
    const warn = vi.fn();
    const logger: Logger = { ...silentLogger, warn };
    expect(gatewayFromEnv(undefined, logger).mode).toBe("simulated");
    expect(warn).not.toHaveBeenCalled();
    expect(gatewayFromEnv("sk_live_do_not_use", logger).mode).toBe("simulated");
    expect(warn).toHaveBeenCalledWith("stripe_key_ignored", expect.anything());
    expect(gatewayFromEnv("sk_test_abc123", logger).mode).toBe("stripe_test");
  });

  it("creates simulated intents with the pi_sim_ prefix", async () => {
    const gateway = gatewayFromEnv(undefined, silentLogger);
    expect(await gateway.createIntent({ amountCents: 464, sessionId: "cs_x", description: "x" })).toMatch(/^pi_sim_[0-9a-f]{18}$/);
  });
});

describe("email", () => {
  const dirs: string[] = [];
  const tmp = (): string => {
    const dir = mkdtempSync(path.join(tmpdir(), "hearth-mail-"));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    resend.send.mockReset();
  });

  const message: EmailMessage = {
    to: "priya@example.com",
    subject: "Your Hearth order HRT-123456 is confirmed · 1× washer",
    text: "plain body",
    html: "<p>html body</p>",
    tag: "ord_abc123",
  };

  it("writes an .eml that round-trips, including a non-ASCII subject", async () => {
    const dir = tmp();
    const mail = createOutboxEmail(dir, "Hearth <orders@hearth.example>", () => new Date("2026-10-21T15:00:00Z"));
    expect(await mail.send(message)).toBe("written_to_outbox");
    const [file] = readdirSync(dir);
    expect(file).toMatch(/^20261021T150000Z-ord_abc123-[0-9a-f]{6}\.eml$/);
    const parsed = parseEml(file ?? "", readFileSync(path.join(dir, file ?? ""), "utf8"));
    expect(parsed).toMatchObject({ to: "priya@example.com", from: "Hearth <orders@hearth.example>", subject: message.subject, text: "plain body", html: "<p>html body</p>" });
    expect((await listOutbox(dir)).map((e) => e.file)).toEqual([file]);
    expect((await readOutboxMessage(dir, file ?? ""))?.html).toBe("<p>html body</p>");
  });

  it("refuses path traversal and non-eml names in the outbox", async () => {
    const dir = tmp();
    expect(await readOutboxMessage(dir, "../secret.eml")).toBeNull();
    expect(await readOutboxMessage(dir, "notes.txt")).toBeNull();
    expect(await listOutbox(path.join(dir, "missing"))).toEqual([]);
  });

  it("sends through Resend when it accepts the message", async () => {
    resend.send.mockResolvedValue({ data: { id: "em_1" }, error: null });
    const dir = tmp();
    const mail = createResendEmail("re_test", "Hearth <onboarding@resend.dev>", createOutboxEmail(dir, "x", () => new Date()), silentLogger);
    expect(await mail.send(message)).toBe("sent");
    expect(resend.send).toHaveBeenCalledWith(expect.objectContaining({ to: "priya@example.com", from: "Hearth <onboarding@resend.dev>" }));
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it("falls back to the outbox when Resend rejects or throws, so the order is never lost", async () => {
    const dir = tmp();
    const mail = createResendEmail("re_test", "x", createOutboxEmail(dir, "x", () => new Date()), silentLogger);
    resend.send.mockResolvedValueOnce({ data: null, error: { name: "validation_error", message: "bad recipient" } });
    expect(await mail.send(message)).toBe("written_to_outbox");
    resend.send.mockRejectedValueOnce(new Error("network down"));
    expect(await mail.send(message)).toBe("written_to_outbox");
    expect(readdirSync(dir)).toHaveLength(2);
  });
});
