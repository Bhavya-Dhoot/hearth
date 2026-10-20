import { randomBytes } from "node:crypto";
import Stripe from "stripe";
import type { Logger } from "../log";

export interface IntentRequest {
  amountCents: number;
  sessionId: string;
  description: string;
}

/** Test-mode payments only. `stripe_test` talks to Stripe with a test key; `simulated` never leaves the process. */
export interface PaymentGateway {
  readonly mode: "stripe_test" | "simulated";
  createIntent(request: IntentRequest): Promise<string>;
  /** Confirms an intent this gateway created. Simulated ids (`pi_sim_*`) are a no-op. */
  confirmIntent(intentId: string): Promise<void>;
}

export const SIMULATED_PREFIX = "pi_sim_";
export const isSimulatedIntent = (id: string): boolean => id.startsWith(SIMULATED_PREFIX);

export function createSimulatedGateway(): PaymentGateway {
  return {
    mode: "simulated",
    async createIntent() {
      return `${SIMULATED_PREFIX}${randomBytes(9).toString("hex")}`;
    },
    async confirmIntent() {
      return undefined;
    },
  };
}

/** Stripe test-mode keys only. Anything else is refused so the server can never create a live charge. */
export const isTestKey = (key: string): boolean => /^(sk|rk)_test_/.test(key);

/** Structural slice of the Stripe client the gateway uses, so tests can supply a double. */
export interface StripeLike {
  paymentIntents: {
    create(params: Stripe.PaymentIntentCreateParams, options?: Stripe.RequestOptions): Promise<{ id: string }>;
    confirm(id: string, params: Stripe.PaymentIntentConfirmParams): Promise<{ id: string; status: string }>;
  };
}

export function createStripeGateway(client: StripeLike): PaymentGateway {
  return {
    mode: "stripe_test",
    async createIntent(request) {
      const intent = await client.paymentIntents.create(
        {
          amount: request.amountCents,
          currency: "usd",
          capture_method: "automatic",
          allowed_payment_method_types: ["card"],
          description: request.description,
          metadata: { checkout_session_id: request.sessionId, app: "hearth" },
        },
        { idempotencyKey: `hearth_${request.sessionId}` },
      );
      return intent.id;
    },
    async confirmIntent(intentId) {
      if (isSimulatedIntent(intentId)) return;
      const confirmed = await client.paymentIntents.confirm(intentId, { payment_method: "pm_card_visa" });
      if (confirmed.status !== "succeeded") throw new Error(`stripe_payment_${confirmed.status}`);
    },
  };
}

export function gatewayFromEnv(secretKey: string | undefined, logger: Logger): PaymentGateway {
  if (!secretKey) return createSimulatedGateway();
  if (!isTestKey(secretKey)) {
    logger.warn("stripe_key_ignored", { reason: "Only Stripe test keys (sk_test_ or rk_test_) are accepted; using simulated payments." });
    return createSimulatedGateway();
  }
  return createStripeGateway(new Stripe(secretKey));
}
