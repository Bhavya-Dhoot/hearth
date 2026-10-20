import {
  CompleteCheckoutSessionRequest,
  CreateCheckoutSessionRequest,
  type InsufficientScopeBody,
} from "@hearth/contracts";
import { Router, json, type Request, type Response } from "express";
import type { z } from "zod";
import { authOf, subjectOf } from "../auth/middleware";
import { HTTP_STATUS, HearthError, fail } from "../errors";
import { completeSession, createSession, loadSession, toRestCompleted, toRestSession } from "../services/checkout";
import type { Core, Ctx } from "../services/core";

const SCOPE = "orders:write" as const;

function send(res: Response, status: number, error: string, description: string): void {
  res.status(status).json({ error, error_description: description });
}

/**
 * UCP-shaped checkout REST surface (docs/CHECKOUT.md). Mounted behind bearerAuth.
 * It shares its service with the create_checkout_session and complete_checkout tools.
 */
export function checkoutRouter(core: Core): Router {
  const router = Router();
  router.use(json({ limit: "64kb" }));

  router.use((req, res, next) => {
    if (authOf(req)?.scopes.includes(SCOPE)) return next();
    const body: z.infer<typeof InsufficientScopeBody> = {
      error: "insufficient_scope",
      error_description: "This request needs the orders:write scope. Link your Hearth account again and allow ordering.",
      required_scope: SCOPE,
    };
    res.status(403).json(body);
  });

  async function contextOf(req: Request): Promise<Ctx> {
    const sub = subjectOf(req);
    if (!sub) throw fail("unauthorized", "Link your Hearth account to continue.");
    const home = await core.repo.getHomeForUser(sub);
    if (!home) throw fail("no_home", "No home is set up for this account yet.");
    const email = authOf(req)?.extra?.email;
    return { userId: sub, home, ...(typeof email === "string" ? { email } : {}) };
  }

  function handle(fn: (req: Request, res: Response, ctx: Ctx) => Promise<void>) {
    return async (req: Request, res: Response): Promise<void> => {
      try {
        await fn(req, res, await contextOf(req));
      } catch (err) {
        if (err instanceof HearthError) return send(res, HTTP_STATUS[err.code], err.code, err.voice);
        core.logger.error("checkout_rest_failed", { message: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
        send(res, 500, "internal", "Something went wrong on our side. Please try again.");
      }
    };
  }

  router.post(
    "/",
    handle(async (req, res, ctx) => {
      const parsed = CreateCheckoutSessionRequest.safeParse(req.body);
      if (!parsed.success) return send(res, 400, "invalid_request", parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
      const [item] = parsed.data.line_items;
      if (!item) return send(res, 400, "invalid_request", "line_items must contain one item");
      const row = await createSession(core, ctx, { sku: item.sku, qty: item.quantity, idempotencyKey: parsed.data.idempotency_key });
      res.json(toRestSession(core, row));
    }),
  );

  router.get(
    "/:id",
    handle(async (req, res, ctx) => {
      res.json(toRestSession(core, await loadSession(core, ctx, String(req.params.id))));
    }),
  );

  router.post(
    "/:id/complete",
    handle(async (req, res, ctx) => {
      const raw: Record<string, unknown> = typeof req.body === "object" && req.body !== null ? (req.body as Record<string, unknown>) : {};
      const phrase = raw.confirmation_phrase;
      if (raw.user_confirmed !== true || typeof phrase !== "string" || phrase.trim() === "") {
        return send(res, 400, "not_confirmed", "user_confirmed must be true and confirmation_phrase must hold the customer's own words.");
      }
      const parsed = CompleteCheckoutSessionRequest.safeParse(raw);
      if (!parsed.success) return send(res, 400, "invalid_request", parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
      const sessionId = String(req.params.id);
      const out = await completeSession(core, ctx, {
        sessionId,
        userConfirmed: true,
        confirmationPhrase: parsed.data.confirmation_phrase,
        idempotencyKey: parsed.data.idempotency_key,
      });
      res.json(toRestCompleted(sessionId, out));
    }),
  );

  return router;
}
