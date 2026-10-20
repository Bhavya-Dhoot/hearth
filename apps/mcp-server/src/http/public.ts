import { ProBriefOutput, SCOPES, SERVER_NAME, SUPPORT_EMAIL, type ProtectedResourceMetadata } from "@hearth/contracts";
import express, { Router, type Response } from "express";
import { RECEIPT_INDEX } from "../services/checkout";
import type { Core } from "../services/core";
import { isoDateIn } from "../services/dates";
import { listOutbox, readOutboxMessage } from "../services/email";
import { z } from "zod";
import { renderBrief, renderNotFound, renderOutboxList, renderOutboxMessage, renderReceipt } from "./pages";

export interface PublicOptions {
  mcpBase: string;
  authIssuer: string;
  mediaDir: string;
  outboxDir: string;
  version: string;
  liveStats: () => { sessions: number; widgets: number };
}

const ReceiptPointer = z.object({ homeId: z.string() });

function html(res: Response, status: number, page: string): void {
  res.status(status).type("html").set("Cache-Control", "no-store").send(page);
}

/** Everything that needs no bearer: discovery, health, media, and the capability-URL pages. */
export function publicRouter(core: Core, opts: PublicOptions): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({
      name: SERVER_NAME,
      version: opts.version,
      mcp: `${opts.mcpBase}/mcp`,
      protectedResourceMetadata: `${opts.mcpBase}/.well-known/oauth-protected-resource`,
      health: `${opts.mcpBase}/healthz`,
    });
  });

  router.get("/healthz", (_req, res) => {
    res.json({ status: "ok", name: SERVER_NAME, version: opts.version, uptimeSeconds: Math.round(process.uptime()), ...opts.liveStats() });
  });

  // RFC 9728 clients look for the path-suffixed URL first (resource http://host/mcp), then the root one that docs/AUTH.md pins.
  router.get(["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"], (_req, res) => {
    const body: ProtectedResourceMetadata = {
      resource: `${opts.mcpBase}/mcp`,
      authorization_servers: [opts.authIssuer],
      scopes_supported: [...SCOPES],
      bearer_methods_supported: ["header"],
      resource_name: "Hearth",
    };
    res.json(body);
  });

  router.use("/media", express.static(opts.mediaDir, { maxAge: "1h", index: false, setHeaders: (res) => res.setHeader("Cross-Origin-Resource-Policy", "cross-origin") }));

  router.get("/receipts/:orderId", async (req, res) => {
    const orderId = String(req.params.orderId);
    const pointer = ReceiptPointer.safeParse(await core.repo.getIdempotent(RECEIPT_INDEX, orderId));
    const order = pointer.success ? (await core.repo.listOrders(pointer.data.homeId)).find((o) => o.orderId === orderId) : undefined;
    if (!pointer.success || !order) return html(res, 404, renderNotFound("Receipt not found"));
    const session = await core.repo.getCheckoutSession(pointer.data.homeId, order.checkoutSessionId);
    const item = core.parts.getSku(order.sku);
    const subtotal = session?.subtotal ?? order.total;
    html(
      res,
      200,
      renderReceipt({
        orderNumber: order.orderNumber,
        itemName: item?.name ?? "Your item",
        qty: order.qty,
        unitPrice: session?.unitPrice ?? item?.price ?? subtotal,
        subtotal,
        tax: session?.tax ?? 0,
        shipping: session?.shipping ?? 0,
        total: order.total,
        paymentDisplay: session?.paymentDisplay ?? "Stored payment method",
        etaDate: order.etaDate,
        paymentMode: order.stripePiId.startsWith("pi_sim_") ? "simulated" : "stripe_test",
        supportEmail: SUPPORT_EMAIL,
      }),
    );
  });

  router.get("/briefs/:token", async (req, res) => {
    const row = await core.repo.getBriefByToken(String(req.params.token));
    const brief = row ? ProBriefOutput.safeParse(row.payload) : undefined;
    if (!row || !brief?.success) return html(res, 404, renderNotFound("Brief not found"));
    html(res, 200, renderBrief(brief.data, isoDateIn(new Date(row.ts), "UTC")));
  });

  router.get("/outbox", async (_req, res) => {
    html(res, 200, renderOutboxList(await listOutbox(opts.outboxDir)));
  });

  router.get("/outbox/:file", async (req, res) => {
    const message = await readOutboxMessage(opts.outboxDir, String(req.params.file));
    html(res, message ? 200 : 404, message ? renderOutboxMessage(message) : renderNotFound("Message not found"));
  });

  return router;
}
