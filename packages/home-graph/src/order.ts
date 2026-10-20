import type { Asset, EventType, HomeEvent, Issue, Order, Task } from "@hearth/contracts";

/**
 * Shared list ordering so MemoryRepo and DynamoRepo return identical results.
 * Everything is newest first, except tasks (due date ascending) and assets (newest first,
 * ties by id so the order never depends on insertion).
 */

const desc = (a: string, b: string): number => (a < b ? 1 : a > b ? -1 : 0);
const asc = (a: string, b: string): number => -desc(a, b);

export const sortAssets = (assets: Asset[]): Asset[] =>
  [...assets].sort((a, b) => desc(a.createdAt, b.createdAt) || asc(a.assetId, b.assetId));

export const sortIssues = (issues: Issue[]): Issue[] =>
  [...issues].sort((a, b) => desc(a.ts, b.ts) || desc(a.issueRecordId, b.issueRecordId));

export const sortOrders = (orders: Order[]): Order[] =>
  [...orders].sort((a, b) => desc(a.ts, b.ts) || desc(a.orderId, b.orderId));

export const sortEvents = (events: HomeEvent[]): HomeEvent[] =>
  [...events].sort((a, b) => desc(a.ts, b.ts) || desc(a.eventId, b.eventId));

export const sortTasks = (tasks: Task[]): Task[] =>
  [...tasks].sort((a, b) => asc(a.dueDate, b.dueDate) || asc(a.taskId, b.taskId));

export interface EventFilter {
  assetId?: string | undefined;
  type?: EventType | undefined;
  limit?: number | undefined;
}

/** Apply listEvents options to events that already belong to the right home. */
export function filterEvents(events: HomeEvent[], opts: EventFilter = {}): HomeEvent[] {
  const matching = events.filter((e) => (opts.assetId === undefined || e.assetId === opts.assetId) && (opts.type === undefined || e.type === opts.type));
  const sorted = sortEvents(matching);
  return opts.limit !== undefined ? sorted.slice(0, Math.max(0, opts.limit)) : sorted;
}
