import { Asset, CheckoutSessionRow, Home, HomeEvent, Issue, Order, ProBriefRow, Task } from "@hearth/contracts";

export const USER = "usr_test";
export const HOME = "home_test";

export const home = (over: Partial<Home> = {}): Home =>
  Home.parse({ userId: USER, homeId: HOME, name: "Test House", city: "Austin", state: "TX", yearBuilt: 2004, climateZone: "2A", timezone: "America/Chicago", ...over });

export const asset = (assetId: string, createdAt = "2026-10-14T09:00:00-05:00", over: Record<string, unknown> = {}): Asset =>
  Asset.parse({ homeId: HOME, assetId, type: "fixture", category: "ptrap", label: `thing ${assetId}`, location: { room: "Kitchen" }, createdAt, updatedAt: createdAt, ...over });

export const issue = (issueRecordId: string, ts: string, over: Record<string, unknown> = {}): Issue =>
  Issue.parse({ homeId: HOME, issueRecordId, ts, symptomText: "water under the sink", playbookId: "leak-under-sink-ptrap", status: "open", ...over });

export const order = (orderId: string, ts: string): Order =>
  Order.parse({ homeId: HOME, orderId, orderNumber: `HR-${orderId}`, ts, sku: "HR-PT-150-WSH", qty: 1, total: 4.64, currency: "USD", status: "completed", checkoutSessionId: "cs_1", stripePiId: "pi_sim_1", etaDate: "2026-10-22" });

export const event = (eventId: string, ts: string, over: Record<string, unknown> = {}): HomeEvent =>
  HomeEvent.parse({ homeId: HOME, eventId, ts, type: "maintenance", summary: `event ${eventId}`, ...over });

export const brief = (briefId: string, publicToken: string, homeId = HOME): ProBriefRow =>
  ProBriefRow.parse({ homeId, briefId, ts: "2026-10-21T10:00:00-05:00", payload: { headline: "Disposal leak" }, publicToken });

export const task = (taskId: string, dueDate: string, over: Record<string, unknown> = {}): Task =>
  Task.parse({ homeId: HOME, taskId, dueDate, kind: "inspection", title: `task ${taskId}`, priority: 3, ...over });

export const checkout = (sessionId: string, over: Record<string, unknown> = {}): CheckoutSessionRow =>
  CheckoutSessionRow.parse({
    homeId: HOME, sessionId, ts: "2026-10-21T10:00:00-05:00", status: "ready_for_complete", sku: "HR-PT-150-WSH", qty: 1, unitPrice: 4.29,
    subtotal: 4.29, tax: 0.35, shipping: 0, total: 4.64, etaDate: "2026-10-22", paymentDisplay: "Visa 4242", commitmentText: "You're ordering 1 item.",
    stripePiId: "pi_sim_1", expiresAt: "2026-10-21T10:30:00-05:00", ...over,
  });
