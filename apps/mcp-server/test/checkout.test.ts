import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  CheckoutSessionResponse,
  CompleteCheckoutOutput,
  CompletedCheckoutResponse,
  CreateCheckoutOutput,
  InsufficientScopeBody,
  PAYMENT_DISPLAY,
  UiMeta,
} from "@hearth/contracts";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStripeGateway, type StripeLike } from "../src/services/payments";
import { type Harness, startHarness } from "./fixtures/harness";
import { rest } from "./fixtures/rpc";
import { NOW, OTHER_USER } from "./fixtures/seed";

const SKU = "HR-PT-150-WSH";
let h: Harness;
let client: Client;
let clock = NOW;

beforeAll(async () => {
  h = await startHarness({ now: () => clock });
  client = await h.connect();
  await client.listTools();
});
afterAll(async () => {
  await h.close();
});

const call = async (name: string, args: Record<string, unknown>): Promise<CallToolResult> => (await client.callTool({ name, arguments: args })) as CallToolResult;
const as = <T>(schema: z.ZodType<T>, r: CallToolResult): T => schema.parse(r.structuredContent);
const say = (r: CallToolResult): string => {
  const first = r.content[0];
  return first && "text" in first ? first.text : "";
};

describe("MCP checkout flow", () => {
  let sessionId = "";

  it("prices deterministically and returns the commitment text without charging", async () => {
    const r = await call("create_checkout_session", { sku: SKU, qty: 1, idempotencyKey: "co-create-0001" });
    const d = as(CreateCheckoutOutput, r);
    sessionId = d.sessionId;
    expect(sessionId).toMatch(/^cs_[0-9a-f]{18}$/);
    expect(d.lineItems).toEqual([{ sku: SKU, name: "1-1/2 inch slip-joint washer kit", qty: 1, unitPrice: 4.29 }]);
    expect(d.totals).toEqual({ subtotal: 4.29, tax: 0.35, shipping: 0, total: 4.64, currency: "USD" });
    expect(d.etaDate).toBe("2026-10-23");
    expect(d.paymentDisplay).toBe(PAYMENT_DISPLAY);
    expect(d.commitmentText).toBe(`You're ordering 1× 1-1/2 inch slip-joint washer kit for $4.64, arriving Friday. Paid with ${PAYMENT_DISPLAY}.`);
    expect(say(r)).toBe(`${d.commitmentText} Confirm?`);
    expect(UiMeta.parse((r._meta as Record<string, unknown>).ui)).toMatchObject({ widget: "checkout-card", pattern: "card" });
    expect(h.repo.orders.size).toBe(0);
    expect(h.repo.sessions.get(sessionId)).toMatchObject({ status: "ready_for_complete", stripePiId: expect.stringMatching(/^pi_sim_/) });
  });

  it("replays create with the same key and prices quantities and tax to the cent", async () => {
    const again = await call("create_checkout_session", { sku: SKU, qty: 1, idempotencyKey: "co-create-0001" });
    expect(as(CreateCheckoutOutput, again).sessionId).toBe(sessionId);
    expect(h.repo.sessions.size).toBe(1);

    const three = as(CreateCheckoutOutput, await call("create_checkout_session", { sku: "HR-FLT-16251", qty: 3, idempotencyKey: "co-create-0002" }));
    expect(three.totals).toEqual({ subtotal: 44.97, tax: 3.71, shipping: 0, total: 48.68, currency: "USD" });
    expect(three.etaDate).toBe("2026-10-22");
  });

  it("rejects an unknown SKU without leaking it", async () => {
    const r = await call("create_checkout_session", { sku: "HR-NOPE", qty: 1, idempotencyKey: "co-create-0003" });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ error: { code: "not_found" } });
    expect(say(r)).not.toContain("HR-NOPE");
  });

  it("refuses to complete without an explicit yes", async () => {
    for (const args of [
      { sessionId, userConfirmed: false, confirmationPhrase: "yes", idempotencyKey: "co-done-0001" },
      { sessionId, userConfirmed: true, idempotencyKey: "co-done-0001" },
      { sessionId, userConfirmed: true, confirmationPhrase: "   ", idempotencyKey: "co-done-0001" },
      { sessionId, confirmationPhrase: "yes", idempotencyKey: "co-done-0001" },
    ]) {
      const r = await call("complete_checkout", args);
      expect(r.isError).toBe(true);
      expect(r.structuredContent).toMatchObject({ error: { code: "not_confirmed" } });
    }
    expect(h.repo.orders.size).toBe(0);
  });

  it("completes, writes the order, the timeline event and the confirmation email", async () => {
    const r = await call("complete_checkout", { sessionId, userConfirmed: true, confirmationPhrase: "yes, confirm", idempotencyKey: "co-done-0002" });
    expect(r.isError).toBeFalsy();
    const d = as(CompleteCheckoutOutput, r);
    expect(d).toMatchObject({
      state: "confirmation",
      orderNumber: expect.stringMatching(/^HRT-\d{6}$/),
      chargedAmount: 4.64,
      etaDate: "2026-10-23",
      supportEmail: "support@hearth.example",
      emailStatus: "written_to_outbox",
      paymentMode: "simulated",
    });
    expect(d.receiptUrl).toBe(`${h.base}/receipts/${d.orderId}`);
    expect(d.summary).toContain("1× 1-1/2 inch slip-joint washer kit");
    expect(d.summary).toContain("Friday, October 23");
    expect(say(r)).toContain("saved in the outbox");
    expect(say(r)).not.toContain("•");
    expect(UiMeta.parse((r._meta as Record<string, unknown>).ui)).toMatchObject({ widget: "checkout-card" });

    expect(h.repo.orders.size).toBe(1);
    expect(h.repo.sessions.get(sessionId)).toMatchObject({ status: "completed", orderId: d.orderId });
    const event = (await h.repo.listEvents("home_okafor", { type: "order" }))[0];
    expect(event).toMatchObject({ type: "order", cost: 4.64 });

    const files = readdirSync(h.outboxDir);
    expect(files).toHaveLength(1);
    const eml = readFileSync(path.join(h.outboxDir, files[0] ?? ""), "utf8");
    expect(eml).toContain(`Your Hearth order ${d.orderNumber} is confirmed`);
    expect(eml).toContain("To: usr_okafor@users.hearth.example");
    expect(eml).toContain(d.receiptUrl);
  });

  it("returns the stored order on a repeated key, and never charges twice for one session", async () => {
    const first = as(CompleteCheckoutOutput, await call("complete_checkout", { sessionId, userConfirmed: true, confirmationPhrase: "yes", idempotencyKey: "co-done-0002" }));
    const second = as(CompleteCheckoutOutput, await call("complete_checkout", { sessionId, userConfirmed: true, confirmationPhrase: "confirm", idempotencyKey: "co-done-0099" }));
    expect(second.orderId).toBe(first.orderId);
    expect(h.repo.orders.size).toBe(1);
    expect(readdirSync(h.outboxDir)).toHaveLength(1);
  });

  it("survives two identical completions in flight at once", async () => {
    const s = as(CreateCheckoutOutput, await call("create_checkout_session", { sku: "HR-9V-BATT", qty: 1, idempotencyKey: "co-create-0004" }));
    const args = { sessionId: s.sessionId, userConfirmed: true, confirmationPhrase: "yes", idempotencyKey: "co-done-race1" };
    const [a, b] = await Promise.all([call("complete_checkout", args), call("complete_checkout", args)]);
    expect(as(CompleteCheckoutOutput, a).orderId).toBe(as(CompleteCheckoutOutput, b).orderId);
    expect(h.repo.orders.size).toBe(2);
  });

  it("serves the receipt page for the order, and 404s a made-up id", async () => {
    const order = [...h.repo.orders.values()].find((o) => o.sku === SKU);
    const page = await fetch(`${h.base}/receipts/${order?.orderId}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain(order?.orderNumber ?? "missing");
    expect(html).toContain("1-1/2 inch slip-joint washer kit");
    expect(html).toContain("$4.64");
    expect(html).toContain("Friday, October 23");
    expect(html).toContain("simulated payment");
    expect(html).toContain("ORDERED");
    expect((await fetch(`${h.base}/receipts/ord_doesnotexist`)).status).toBe(404);
  });

  it("lists and renders the email in the outbox", async () => {
    const list = await (await fetch(`${h.base}/outbox`)).text();
    const file = readdirSync(h.outboxDir).find((f) => f.includes("ord_"));
    expect(file).toBeDefined();
    expect(list).toContain("is confirmed");
    expect(list).toContain(`/outbox/${file}`);
    const message = await fetch(`${h.base}/outbox/${file}`);
    expect(message.status).toBe(200);
    const html = await message.text();
    expect(html).toContain("iframe");
    expect(html).toContain("View your receipt");
    expect((await fetch(`${h.base}/outbox/..%2F..%2Fpackage.json`)).status).toBe(404);
    expect((await fetch(`${h.base}/outbox/missing.eml`)).status).toBe(404);
  });

  it("expires a session after 30 minutes", async () => {
    const s = as(CreateCheckoutOutput, await call("create_checkout_session", { sku: SKU, qty: 2, idempotencyKey: "co-create-0005" }));
    clock = new Date(NOW.getTime() + 31 * 60_000);
    try {
      const token = await h.mint();
      const view = await rest(h.base, `/checkout-sessions/${s.sessionId}`, { token });
      expect(view.status).toBe(200);
      expect(CheckoutSessionResponse.parse(view.body).status).toBe("expired");

      const r = await call("complete_checkout", { sessionId: s.sessionId, userConfirmed: true, confirmationPhrase: "yes", idempotencyKey: "co-done-late1" });
      expect(r.isError).toBe(true);
      expect(r.structuredContent).toMatchObject({ error: { code: "session_expired" } });
      expect(say(r)).toContain("nothing was charged");

      const rest410 = await rest(h.base, `/checkout-sessions/${s.sessionId}/complete`, {
        token,
        method: "POST",
        body: { user_confirmed: true, confirmation_phrase: "yes", idempotency_key: "co-done-late2" },
      });
      expect(rest410.status).toBe(410);
    } finally {
      clock = NOW;
    }
  });

  it("does not show one household's session to another", async () => {
    const s = as(CreateCheckoutOutput, await call("create_checkout_session", { sku: SKU, qty: 1, idempotencyKey: "co-create-0006" }));
    const other = await h.connect(await h.mint({ sub: OTHER_USER }));
    const r = (await other.callTool({ name: "complete_checkout", arguments: { sessionId: s.sessionId, userConfirmed: true, confirmationPhrase: "yes", idempotencyKey: "co-done-other" } })) as CallToolResult;
    expect(r.structuredContent).toMatchObject({ error: { code: "not_found" } });
    expect(h.repo.sessions.get(s.sessionId)?.status).toBe("ready_for_complete");
  });
});

describe("REST /checkout-sessions", () => {
  let token = "";
  let id = "";
  beforeAll(async () => {
    token = await h.mint();
  });

  it("creates a UCP-shaped session and is idempotent", async () => {
    const body = { line_items: [{ sku: SKU, quantity: 1 }], idempotency_key: "rest-create-1" };
    const res = await rest(h.base, "/checkout-sessions", { token, method: "POST", body });
    expect(res.status).toBe(200);
    const s = CheckoutSessionResponse.parse(res.body);
    id = s.id;
    expect(s).toMatchObject({
      status: "ready_for_complete",
      line_items: [{ sku: SKU, name: "1-1/2 inch slip-joint washer kit", quantity: 1, unit_price: 4.29 }],
      totals: { subtotal: 4.29, tax: 0.35, shipping: 0, total: 4.64, currency: "USD" },
      fulfillment: { eta_date: "2026-10-23" },
      payment: { method: "stored_payment_method", display: PAYMENT_DISPLAY },
    });
    expect(s.commitment_text).toContain("$4.64");
    expect(Date.parse(s.expires_at) - NOW.getTime()).toBe(30 * 60_000);

    const again = await rest(h.base, "/checkout-sessions", { token, method: "POST", body });
    expect(CheckoutSessionResponse.parse(again.body).id).toBe(id);

    const got = await rest(h.base, `/checkout-sessions/${id}`, { token });
    expect(CheckoutSessionResponse.parse(got.body)).toEqual(s);
  });

  it("answers 400 for a bad body and 404 for an unknown session", async () => {
    const bad = await rest(h.base, "/checkout-sessions", { token, method: "POST", body: { line_items: [], idempotency_key: "short" } });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ error: "invalid_request" });
    const missing = await rest(h.base, "/checkout-sessions/cs_nope", { token });
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ error: "not_found" });
  });

  it("returns 403 InsufficientScopeBody without orders:write", async () => {
    const weak = await h.mint({ scope: "home:read home:write" });
    const res = await rest(h.base, "/checkout-sessions", { token: weak, method: "POST", body: { line_items: [{ sku: SKU, quantity: 1 }], idempotency_key: "rest-create-2" } });
    expect(res.status).toBe(403);
    expect(InsufficientScopeBody.parse(res.body)).toMatchObject({ error: "insufficient_scope", required_scope: "orders:write" });
  });

  it("requires user_confirmed and the customer's words, then completes", async () => {
    const complete = (body: unknown) => rest(h.base, `/checkout-sessions/${id}/complete`, { token, method: "POST", body });
    expect((await complete({ confirmation_phrase: "yes", idempotency_key: "rest-done-0001" })).status).toBe(400);
    const missing = await complete({ user_confirmed: true, idempotency_key: "rest-done-0001" });
    expect(missing.status).toBe(400);
    expect(missing.body).toMatchObject({ error: "not_confirmed" });
    expect((await complete({ user_confirmed: true, confirmation_phrase: "yes", idempotency_key: "x" })).status).toBe(400);

    const ok = await complete({ user_confirmed: true, confirmation_phrase: "yes please", idempotency_key: "rest-done-0001" });
    expect(ok.status).toBe(200);
    const done = CompletedCheckoutResponse.parse(ok.body);
    expect(done).toMatchObject({
      id,
      status: "completed",
      order: { number: expect.stringMatching(/^HRT-\d{6}$/) },
      confirmation: { eta_date: "2026-10-23", support_email: "support@hearth.example", charged_amount: 4.64 },
    });
    expect(done.confirmation.receipt_url).toBe(`${h.base}/receipts/${done.order.id}`);

    const replay = await complete({ user_confirmed: true, confirmation_phrase: "yes please", idempotency_key: "rest-done-0001" });
    expect(CompletedCheckoutResponse.parse(replay.body).order.id).toBe(done.order.id);
    const got = await rest(h.base, `/checkout-sessions/${id}`, { token });
    expect(CheckoutSessionResponse.parse(got.body).status).toBe("completed");
  });
});

describe("Stripe test mode", () => {
  it("creates an unconfirmed automatic-capture PaymentIntent and confirms it with the test card on complete", async () => {
    const calls: { create?: Record<string, unknown>; options?: unknown; confirm?: { id: string; params: unknown } } = {};
    const fake: StripeLike = {
      paymentIntents: {
        async create(params, options) {
          calls.create = { ...params };
          calls.options = options;
          return { id: "pi_3TestIntent" };
        },
        async confirm(intentId, params) {
          calls.confirm = { id: intentId, params };
          return { id: intentId, status: "succeeded" };
        },
      },
    };
    const stripe = await startHarness({ payments: createStripeGateway(fake) });
    try {
      const c = await stripe.connect();
      const created = (await c.callTool({ name: "create_checkout_session", arguments: { sku: SKU, qty: 1, idempotencyKey: "stripe-create-1" } })) as CallToolResult;
      const s = CreateCheckoutOutput.parse(created.structuredContent);
      expect(calls.create).toMatchObject({ amount: 464, currency: "usd", capture_method: "automatic", allowed_payment_method_types: ["card"] });
      expect(calls.create).not.toHaveProperty("confirm");
      expect(calls.confirm).toBeUndefined();

      const done = (await c.callTool({ name: "complete_checkout", arguments: { sessionId: s.sessionId, userConfirmed: true, confirmationPhrase: "yes", idempotencyKey: "stripe-done-001" } })) as CallToolResult;
      expect(CompleteCheckoutOutput.parse(done.structuredContent).paymentMode).toBe("stripe_test");
      expect(calls.confirm).toEqual({ id: "pi_3TestIntent", params: { payment_method: "pm_card_visa" } });
    } finally {
      await stripe.close();
    }
  });

  it("does not charge or place an order when the payment fails", async () => {
    const failing: StripeLike = {
      paymentIntents: {
        async create() {
          return { id: "pi_3Declined" };
        },
        async confirm(intentId) {
          return { id: intentId, status: "requires_payment_method" };
        },
      },
    };
    const stripe = await startHarness({ payments: createStripeGateway(failing) });
    try {
      const c = await stripe.connect();
      const created = CreateCheckoutOutput.parse(((await c.callTool({ name: "create_checkout_session", arguments: { sku: SKU, qty: 1, idempotencyKey: "stripe-create-2" } })) as CallToolResult).structuredContent);
      const done = (await c.callTool({ name: "complete_checkout", arguments: { sessionId: created.sessionId, userConfirmed: true, confirmationPhrase: "yes", idempotencyKey: "stripe-done-002" } })) as CallToolResult;
      expect(done.isError).toBe(true);
      expect(say(done)).toContain("haven't been charged");
      expect(stripe.repo.orders.size).toBe(0);
      expect(stripe.repo.sessions.get(created.sessionId)?.status).toBe("ready_for_complete");
    } finally {
      await stripe.close();
    }
  });
});
