import { z } from "zod";
import { IsoDate } from "./common";

/** C6 - UCP-shaped checkout REST bodies (PRD 7.6). Prose in docs/CHECKOUT.md. */

export const CreateCheckoutSessionRequest = z.object({
  line_items: z.array(z.object({ sku: z.string(), quantity: z.number().int().min(1).max(10) })).length(1),
  idempotency_key: z.string().min(8),
});
export type CreateCheckoutSessionRequest = z.infer<typeof CreateCheckoutSessionRequest>;

export const CheckoutSessionResponse = z.object({
  id: z.string(),
  status: z.enum(["ready_for_complete", "completed", "expired"]),
  line_items: z.array(z.object({ sku: z.string(), name: z.string(), quantity: z.number().int(), unit_price: z.number() })),
  totals: z.object({ subtotal: z.number(), tax: z.number(), shipping: z.number(), total: z.number(), currency: z.literal("USD") }),
  fulfillment: z.object({ eta_date: IsoDate }),
  payment: z.object({ method: z.literal("stored_payment_method"), display: z.string() }),
  commitment_text: z.string(),
  expires_at: z.string(),
});
export type CheckoutSessionResponse = z.infer<typeof CheckoutSessionResponse>;

export const CompleteCheckoutSessionRequest = z.object({
  user_confirmed: z.literal(true),
  confirmation_phrase: z.string().min(1),
  idempotency_key: z.string().min(8),
});
export type CompleteCheckoutSessionRequest = z.infer<typeof CompleteCheckoutSessionRequest>;

export const CompletedCheckoutResponse = z.object({
  id: z.string(),
  status: z.literal("completed"),
  order: z.object({ id: z.string(), number: z.string() }),
  confirmation: z.object({
    summary: z.string(),
    eta_date: IsoDate,
    support_email: z.string().email(),
    receipt_url: z.string().url(),
    charged_amount: z.number(),
  }),
});
export type CompletedCheckoutResponse = z.infer<typeof CompletedCheckoutResponse>;

/** Pricing rules (deterministic): Austin TX sales tax 8.25%; shipping free (seed household is a Prime member, PRD 3.1). */
export const PRICING = { taxRate: 0.0825, shippingFee: 0, sessionTtlMinutes: 30 } as const;
export const SUPPORT_EMAIL = "support@hearth.example" as const;
export const PAYMENT_DISPLAY = "Visa •••• 4242" as const;
