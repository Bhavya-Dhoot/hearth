import { z } from "zod";
import { IsoDate, IsoDateTime } from "./common";

/**
 * C3 - Home Graph. Single-table DynamoDB design (PRD Section 8).
 * Policy: no field may hold health data or data about children (PRD 2.4).
 */

export const AssetType = z.enum(["appliance", "fixture", "shutoff", "panel", "hvac", "consumable"]);
export type AssetType = z.infer<typeof AssetType>;

/** Normalised 0..1 coordinates of the thing an annotation stroke circles on a photo. */
export const Annotation = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), r: z.number().min(0).max(1) });
export type Annotation = z.infer<typeof Annotation>;

export const Photo = z.object({ url: z.string().url(), alt: z.string(), annotation: Annotation.optional() });
export type Photo = z.infer<typeof Photo>;

export const Consumable = z.object({
  sku: z.string(),
  label: z.string(),
  intervalDays: z.number().int().positive(),
  lastReplaced: IsoDate.optional(),
});
export type Consumable = z.infer<typeof Consumable>;

export const Home = z.object({
  userId: z.string(),
  homeId: z.string(),
  name: z.string(),
  city: z.string(),
  state: z.string(),
  yearBuilt: z.number().int(),
  climateZone: z.string(),
  timezone: z.string(),
  baths: z.number().optional(),
  heatingFuel: z.enum(["gas", "electric", "oil", "heat_pump"]).optional(),
});
export type Home = z.infer<typeof Home>;

/** Attribute keys the exact-fit matcher understands. Values are strings or numbers. */
export const AssetAttributes = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));
export type AssetAttributes = z.infer<typeof AssetAttributes>;

export const Asset = z.object({
  homeId: z.string(),
  assetId: z.string(),
  type: AssetType,
  /** Stable category key used by playbooks and the matcher, e.g. "ptrap", "disposal", "furnace". */
  category: z.string(),
  /** Possessive-friendly label: "kitchen sink P-trap", "garbage disposal". */
  label: z.string(),
  brand: z.string().optional(),
  model: z.string().optional(),
  serial: z.string().optional(),
  installDate: IsoDate.optional(),
  location: z.object({ room: z.string(), note: z.string().optional() }),
  photos: z.array(Photo).default([]),
  attributes: AssetAttributes.default({}),
  consumables: z.array(Consumable).default([]),
  /** Seeded demo recall flag id, matched against the recall dataset. */
  recallIds: z.array(z.string()).default([]),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Asset = z.infer<typeof Asset>;

export const IssueStatus = z.enum(["open", "resolved", "escalated"]);
export const Issue = z.object({
  homeId: z.string(),
  issueRecordId: z.string(),
  ts: IsoDateTime,
  symptomText: z.string(),
  playbookId: z.string().nullable(),
  assetId: z.string().optional(),
  status: IssueStatus,
  answers: z.record(z.string(), z.string()).default({}),
  stepsCompleted: z.number().int().default(0),
});
export type Issue = z.infer<typeof Issue>;

export const OrderStatus = z.enum(["pending", "completed", "cancelled"]);
export const Order = z.object({
  homeId: z.string(),
  orderId: z.string(),
  orderNumber: z.string(),
  ts: IsoDateTime,
  sku: z.string(),
  qty: z.number().int(),
  total: z.number(),
  currency: z.literal("USD"),
  status: OrderStatus,
  checkoutSessionId: z.string(),
  stripePiId: z.string(),
  etaDate: IsoDate,
});
export type Order = z.infer<typeof Order>;

export const EventType = z.enum(["repair", "maintenance", "order", "escalation", "added_asset"]);
export type EventType = z.infer<typeof EventType>;
export const HomeEvent = z.object({
  homeId: z.string(),
  eventId: z.string(),
  ts: IsoDateTime,
  type: EventType,
  assetId: z.string().optional(),
  summary: z.string(),
  cost: z.number().optional(),
  photos: z.array(z.string().url()).default([]),
});
export type HomeEvent = z.infer<typeof HomeEvent>;

export const ProBriefRow = z.object({
  homeId: z.string(),
  briefId: z.string(),
  ts: IsoDateTime,
  assetId: z.string().optional(),
  issueId: z.string().optional(),
  /** Rendered ProBriefOutput (tools.ts). Stored as JSON. */
  payload: z.record(z.string(), z.unknown()),
  publicToken: z.string(),
});
export type ProBriefRow = z.infer<typeof ProBriefRow>;

export const TaskKind = z.enum(["consumable", "inspection", "seasonal", "recall", "follow_up"]);
export const Task = z.object({
  homeId: z.string(),
  taskId: z.string(),
  dueDate: IsoDate,
  assetId: z.string().optional(),
  kind: TaskKind,
  title: z.string(),
  priority: z.number().int().min(1).max(5),
  reorderSku: z.string().optional(),
  done: z.boolean().default(false),
});
export type Task = z.infer<typeof Task>;

/** Checkout session (UCP-shaped, C6). Persisted so complete can be validated. */
export const CheckoutSessionRow = z.object({
  homeId: z.string(),
  sessionId: z.string(),
  ts: IsoDateTime,
  status: z.enum(["ready_for_complete", "completed", "expired"]),
  sku: z.string(),
  qty: z.number().int(),
  unitPrice: z.number(),
  subtotal: z.number(),
  tax: z.number(),
  shipping: z.number(),
  total: z.number(),
  etaDate: IsoDate,
  paymentDisplay: z.string(),
  commitmentText: z.string(),
  stripePiId: z.string(),
  orderId: z.string().optional(),
  expiresAt: IsoDateTime,
});
export type CheckoutSessionRow = z.infer<typeof CheckoutSessionRow>;

/** DynamoDB key builders. PK/SK strings must match PRD Section 8 exactly. */
export const Keys = {
  home: (userId: string, homeId: string) => ({ PK: `USER#${userId}`, SK: `HOME#${homeId}` }),
  asset: (homeId: string, assetId: string) => ({ PK: `HOME#${homeId}`, SK: `ASSET#${assetId}` }),
  issue: (homeId: string, ts: string, issueRecordId: string) => ({ PK: `HOME#${homeId}`, SK: `ISSUE#${ts}#${issueRecordId}` }),
  order: (homeId: string, ts: string, orderId: string) => ({ PK: `HOME#${homeId}`, SK: `ORDER#${ts}#${orderId}` }),
  event: (homeId: string, ts: string, eventId: string) => ({ PK: `HOME#${homeId}`, SK: `EVENT#${ts}#${eventId}` }),
  brief: (homeId: string, briefId: string) => ({ PK: `HOME#${homeId}`, SK: `BRIEF#${briefId}` }),
  task: (homeId: string, dueDate: string, taskId: string) => ({ PK: `HOME#${homeId}`, SK: `TASK#${dueDate}#${taskId}` }),
  checkout: (homeId: string, sessionId: string) => ({ PK: `HOME#${homeId}`, SK: `CHECKOUT#${sessionId}` }),
  idem: (userId: string, key: string) => ({ PK: `IDEM#${userId}`, SK: `KEY#${key}` }),
  /** GSI1: per-asset history. */
  gsi1Event: (assetId: string, ts: string) => ({ GSI1PK: `ASSET#${assetId}`, GSI1SK: `EVENT#${ts}` }),
} as const;

/**
 * Repository interface. Implementations: MemoryRepo (JSON file, dev default) and DynamoRepo
 * (when HEARTH_DDB_TABLE is set). Every method is async; lists are newest-first unless noted.
 */
export interface HomeRepository {
  getHomeForUser(userId: string): Promise<Home | null>;
  putHome(home: Home): Promise<void>;

  listAssets(homeId: string): Promise<Asset[]>;
  getAsset(homeId: string, assetId: string): Promise<Asset | null>;
  putAsset(asset: Asset): Promise<void>;

  putIssue(issue: Issue): Promise<void>;
  listIssues(homeId: string, opts?: { status?: Issue["status"] }): Promise<Issue[]>;

  putOrder(order: Order): Promise<void>;
  listOrders(homeId: string): Promise<Order[]>;

  putEvent(event: HomeEvent): Promise<void>;
  listEvents(homeId: string, opts?: { assetId?: string; type?: EventType; limit?: number }): Promise<HomeEvent[]>;

  putBrief(brief: ProBriefRow): Promise<void>;
  getBrief(homeId: string, briefId: string): Promise<ProBriefRow | null>;
  getBriefByToken(publicToken: string): Promise<ProBriefRow | null>;

  /** Tasks sorted by dueDate ascending. */
  listTasks(homeId: string): Promise<Task[]>;
  putTask(task: Task): Promise<void>;

  putCheckoutSession(row: CheckoutSessionRow): Promise<void>;
  getCheckoutSession(homeId: string, sessionId: string): Promise<CheckoutSessionRow | null>;

  /** Idempotency store for write tools. Returns the stored result for (userId, key) if present. */
  getIdempotent(userId: string, key: string): Promise<unknown | null>;
  putIdempotent(userId: string, key: string, result: unknown): Promise<void>;
}

/** Shape of packages/contracts/seed/okafor-house.json (Appendix C). */
export const SeedFile = z.object({
  home: Home,
  assets: z.array(Asset),
  events: z.array(HomeEvent),
  tasks: z.array(Task),
});
export type SeedFile = z.infer<typeof SeedFile>;
