# Checkout contract (C6)

UCP-style REST `checkout-sessions` on the MCP server, plus two MCP tools that call the same service. Types: `packages/contracts/src/checkout.ts`.

## Rules
- `create_checkout_session` / `POST /checkout-sessions` **never charges**. It prices the item, creates a Stripe test-mode PaymentIntent (`capture_method: automatic`, unconfirmed) when `STRIPE_SECRET_KEY` is set, otherwise a `pi_sim_*` id, and returns `commitment_text`.
- `commitment_text` format: `You're ordering 1× {name} for ${total}, arriving {Weekday}. Paid with {paymentDisplay}.` Alexa reads it verbatim before asking "Confirm?".
- `complete_checkout` / `POST /checkout-sessions/:id/complete` requires `user_confirmed: true` and a non-empty `confirmation_phrase` (the customer's words). Missing -> tool error `not_confirmed` / HTTP 400.
- Completion confirms the PaymentIntent (test card `pm_card_visa`) or marks the simulated one paid, writes an `Order` row and an `order` timeline event, and sends a confirmation email: Resend when `RESEND_API_KEY` is set, otherwise an `.eml` in `apps/mcp-server/.outbox/` (listed at `GET /outbox`, rendered at `GET /outbox/:file`).
- Idempotent: the same `idempotency_key` returns the stored response.
- Sessions expire after 30 minutes -> `session_expired`.
- Pricing: tax 8.25% (Austin, TX), shipping free (Prime household, PRD 3.1), ETA = today + SKU `shipDays` (skip Sunday). Money rounded to cents.
- Payment method: `stored_payment_method`, display `Visa •••• 4242`. `network_token` (Amazon Wallet) needs Amazon Pay merchant onboarding; see FRICTION_LOG.

## Endpoints

`POST /checkout-sessions` (bearer, scope `orders:write`)
```json
{ "line_items": [{ "sku": "HR-PT-150-WSH", "quantity": 1 }], "idempotency_key": "..." }
```
-> `200 CheckoutSessionResponse`
```json
{ "id": "cs_...", "status": "ready_for_complete",
  "line_items": [{ "sku": "HR-PT-150-WSH", "name": "...", "quantity": 1, "unit_price": 4.29 }],
  "totals": { "subtotal": 4.29, "tax": 0.35, "shipping": 0, "total": 4.64, "currency": "USD" },
  "fulfillment": { "eta_date": "2026-10-23" },
  "payment": { "method": "stored_payment_method", "display": "Visa •••• 4242" },
  "commitment_text": "You're ordering 1× ... for $4.64, arriving Thursday. Paid with Visa •••• 4242.",
  "expires_at": "..." }
```

`GET /checkout-sessions/:id` -> `CheckoutSessionResponse`

`POST /checkout-sessions/:id/complete`
```json
{ "user_confirmed": true, "confirmation_phrase": "yes", "idempotency_key": "..." }
```
-> `200 CompletedCheckoutResponse`
```json
{ "id": "cs_...", "status": "completed",
  "order": { "id": "ord_...", "number": "HRT-104233" },
  "confirmation": { "summary": "...", "eta_date": "2026-10-23", "support_email": "support@hearth.example",
                    "receipt_url": "http://localhost:4200/receipts/ord_...", "charged_amount": 4.64 } }
```

`GET /receipts/:orderId` renders a receipt page (design language).
