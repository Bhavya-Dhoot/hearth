import { randomBytes } from "node:crypto";
import {
  CompleteCheckoutOutput as CompleteCheckoutOutputSchema,
  PAYMENT_DISPLAY,
  PRICING,
  SUPPORT_EMAIL,
  type CatalogItem,
  type CheckoutSessionResponse,
  type CheckoutSessionRow,
  type CompleteCheckoutInput,
  type CompleteCheckoutOutput,
  type CompletedCheckoutResponse,
  type CreateCheckoutInput,
  type CreateCheckoutOutput,
  type HomeEvent,
  type Order,
} from "@hearth/contracts";
import { z } from "zod";
import { fail } from "../errors";
import { orderConfirmationEmail } from "../http/emails";
import { type Core, type Ctx, newId, once, todayFor } from "./core";
import { deliveryDate, longDate, weekdayName } from "./dates";
import { money, plain, round2, toCents } from "./format";
import { isSimulatedIntent } from "./payments";

/** Receipts are public capability URLs; this index maps an order id back to its home without a token. */
export const RECEIPT_INDEX = "receipt-index";

const SessionRef = z.object({ sessionId: z.string() });

const nameOf = (core: Core, sku: string): string => core.parts.getSku(sku)?.name ?? "your item";

export function commitmentFor(name: string, qty: number, total: number, etaDate: string, paymentDisplay: string): string {
  return `You're ordering ${qty}× ${name} for ${money(total)}, arriving ${weekdayName(etaDate)}. Paid with ${paymentDisplay}.`;
}

export interface Pricing {
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
}

export function priceOf(unitPrice: number, qty: number): Pricing {
  const subtotal = round2(unitPrice * qty);
  const tax = round2(subtotal * PRICING.taxRate);
  const shipping = PRICING.shippingFee;
  return { subtotal, tax, shipping, total: round2(subtotal + tax + shipping) };
}

/** Applies the 30 minute TTL. Persists the expiry so later reads agree. */
async function withExpiry(core: Core, row: CheckoutSessionRow): Promise<CheckoutSessionRow> {
  if (row.status === "ready_for_complete" && core.now().getTime() >= Date.parse(row.expiresAt)) {
    const expired: CheckoutSessionRow = { ...row, status: "expired" };
    await core.repo.putCheckoutSession(expired);
    return expired;
  }
  return row;
}

export async function loadSession(core: Core, ctx: Ctx, sessionId: string): Promise<CheckoutSessionRow> {
  const row = await core.repo.getCheckoutSession(ctx.home.homeId, sessionId);
  if (!row) throw fail("not_found", "I couldn't find that checkout. Want me to start a new one?");
  return withExpiry(core, row);
}

/* ------------------------------------------------------------------ create */

export async function createSession(core: Core, ctx: Ctx, input: CreateCheckoutInput): Promise<CheckoutSessionRow> {
  const ref = await once(core, ctx.userId, "create_checkout", input.idempotencyKey, SessionRef, async () => {
    const item: CatalogItem | undefined = core.parts.getSku(input.sku);
    if (!item) throw fail("not_found", "I couldn't find that item. Want me to show the closest matches?");

    const price = priceOf(item.price, input.qty);
    const at = core.now();
    const eta = deliveryDate(todayFor(core, ctx.home), item.shipDays);
    const sessionId = `cs_${randomBytes(9).toString("hex")}`;

    let intentId: string;
    try {
      intentId = await core.payments.createIntent({
        amountCents: toCents(price.total),
        sessionId,
        description: `${input.qty} x ${item.name}`,
      });
    } catch (err) {
      core.logger.error("payment_intent_failed", { message: err instanceof Error ? err.message : String(err) });
      throw fail("internal", "I couldn't start checkout right now. Nothing was charged. Please try again in a moment.");
    }

    const row: CheckoutSessionRow = {
      homeId: ctx.home.homeId,
      sessionId,
      ts: at.toISOString(),
      status: "ready_for_complete",
      sku: item.sku,
      qty: input.qty,
      unitPrice: item.price,
      ...price,
      etaDate: eta,
      paymentDisplay: PAYMENT_DISPLAY,
      commitmentText: commitmentFor(item.name, input.qty, price.total, eta, PAYMENT_DISPLAY),
      stripePiId: intentId,
      expiresAt: new Date(at.getTime() + PRICING.sessionTtlMinutes * 60_000).toISOString(),
    };
    await core.repo.putCheckoutSession(row);
    return { sessionId };
  });
  return loadSession(core, ctx, ref.sessionId);
}

export function toCheckoutOutput(core: Core, row: CheckoutSessionRow): CreateCheckoutOutput {
  return {
    state: "checkout",
    sessionId: row.sessionId,
    lineItems: [{ sku: row.sku, name: nameOf(core, row.sku), qty: row.qty, unitPrice: row.unitPrice }],
    totals: { subtotal: row.subtotal, tax: row.tax, shipping: row.shipping, total: row.total, currency: "USD" },
    etaDate: row.etaDate,
    paymentDisplay: row.paymentDisplay,
    commitmentText: row.commitmentText,
  };
}

export function toRestSession(core: Core, row: CheckoutSessionRow): CheckoutSessionResponse {
  return {
    id: row.sessionId,
    status: row.status,
    line_items: [{ sku: row.sku, name: nameOf(core, row.sku), quantity: row.qty, unit_price: row.unitPrice }],
    totals: { subtotal: row.subtotal, tax: row.tax, shipping: row.shipping, total: row.total, currency: "USD" },
    fulfillment: { eta_date: row.etaDate },
    payment: { method: "stored_payment_method", display: row.paymentDisplay },
    commitment_text: row.commitmentText,
    expires_at: row.expiresAt,
  };
}

/* ------------------------------------------------------------------ complete */

const NEXT_SUGGESTION = "When it arrives, tell me and I'll log the job and set your next reminder.";

/** "Visa •••• 4242" reads badly aloud; the card text keeps the dots, speech says "Visa ending in 4242". */
const spokenPayment = (display: string): string => display.replace(/\s*•+\s*/, " ending in ");

const newOrderNumber =(): string => `HRT-${100_000 + (randomBytes(4).readUInt32BE(0) % 900_000)}`;

export async function completeSession(core: Core, ctx: Ctx, input: CompleteCheckoutInput): Promise<CompleteCheckoutOutput> {
  if (input.userConfirmed !== true || input.confirmationPhrase.trim().length === 0) {
    throw fail("not_confirmed", "I need a clear yes from you before I can place the order.");
  }
  return once(core, ctx.userId, "complete_checkout", input.idempotencyKey, CompleteCheckoutOutputSchema, () =>
    core.locks.run(`session|${ctx.home.homeId}|${input.sessionId}`, async () => {
      // The same session confirmed again with a new idempotency key must never charge twice.
      const priorKey = `complete_session:${input.sessionId}`;
      const prior = CompleteCheckoutOutputSchema.safeParse(await core.repo.getIdempotent(ctx.userId, priorKey));
      if (prior.success) return prior.data;

      const row = await loadSession(core, ctx, input.sessionId);
      if (row.status === "expired") throw fail("session_expired", "That checkout timed out, so nothing was charged. Want me to start it again?");
      if (row.status === "completed") throw fail("conflict", "That order was already placed.");

      try {
        if (!isSimulatedIntent(row.stripePiId)) await core.payments.confirmIntent(row.stripePiId);
      } catch (err) {
        core.logger.error("payment_confirm_failed", { sessionId: row.sessionId, message: err instanceof Error ? err.message : String(err) });
        throw fail("internal", "The payment didn't go through, so you haven't been charged. Want to try again?");
      }

      const at = core.now();
      const name = nameOf(core, row.sku);
      const orderId = newId("ord");
      const orderNumber = newOrderNumber();
      const order: Order = {
        homeId: row.homeId,
        orderId,
        orderNumber,
        ts: at.toISOString(),
        sku: row.sku,
        qty: row.qty,
        total: row.total,
        currency: "USD",
        status: "completed",
        checkoutSessionId: row.sessionId,
        stripePiId: row.stripePiId,
        etaDate: row.etaDate,
      };
      await core.repo.putOrder(order);
      await core.repo.putIdempotent(RECEIPT_INDEX, orderId, { homeId: row.homeId });

      const event: HomeEvent = {
        homeId: row.homeId,
        eventId: newId("evt"),
        ts: at.toISOString(),
        type: "order",
        summary: plain(`Ordered ${row.qty}× ${name}, arriving ${weekdayName(row.etaDate)}.`),
        cost: row.total,
        photos: [],
      };
      await core.repo.putEvent(event);
      await core.repo.putCheckoutSession({ ...row, status: "completed", orderId });

      const receiptUrl = `${core.mcpBase}/receipts/${orderId}`;
      const summary = plain(
        `Order ${orderNumber} confirmed: ${row.qty}× ${name} for ${money(row.total)}, paid with ${spokenPayment(row.paymentDisplay)}. It arrives ${longDate(row.etaDate)}.${row.stripePiId.startsWith("pi_sim_") ? " Simulated payment: no card was charged." : " Stripe test mode: no real charge."}`,
      );
      const emailStatus = await core.email.send(
        orderConfirmationEmail({
          to: ctx.email ?? core.defaultRecipient(ctx.userId),
          tag: orderId,
          orderNumber,
          itemName: name,
          qty: row.qty,
          totals: { subtotal: row.subtotal, tax: row.tax, shipping: row.shipping, total: row.total },
          paymentDisplay: row.paymentDisplay,
          etaDate: row.etaDate,
          summary,
          receiptUrl,
          supportEmail: SUPPORT_EMAIL,
        }),
      );

      const output: CompleteCheckoutOutput = {
        state: "confirmation",
        orderId,
        orderNumber,
        summary,
        etaDate: row.etaDate,
        receiptUrl,
        chargedAmount: row.total,
        supportEmail: SUPPORT_EMAIL,
        emailStatus,
        paymentMode: isSimulatedIntent(row.stripePiId) ? "simulated" : "stripe_test",
        nextSuggestion: NEXT_SUGGESTION,
      };
      await core.repo.putIdempotent(ctx.userId, priorKey, output);
      return output;
    }),
  );
}

export function toRestCompleted(sessionId: string, out: CompleteCheckoutOutput): CompletedCheckoutResponse {
  return {
    id: sessionId,
    status: "completed",
    order: { id: out.orderId, number: out.orderNumber },
    confirmation: {
      summary: out.summary,
      eta_date: out.etaDate,
      support_email: out.supportEmail,
      receipt_url: out.receiptUrl,
      charged_amount: out.chargedAmount,
    },
  };
}

export function createSpeech(out: CreateCheckoutOutput): string {
  return `${out.commitmentText} Confirm?`;
}

export function completeSpeech(out: CompleteCheckoutOutput): string {
  const email = out.emailStatus === "sent" ? "I've emailed your confirmation." : "Your confirmation is saved in the outbox.";
  return plain(`Done. ${out.summary} ${email}`);
}
