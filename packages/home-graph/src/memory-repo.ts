import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  Asset,
  CheckoutSessionRow,
  Home,
  HomeEvent,
  Issue,
  Order,
  ProBriefRow,
  Task,
  type EventType,
  type HomeRepository,
} from "@hearth/contracts";
import { z } from "zod";
import { filterEvents, sortAssets, sortIssues, sortOrders, sortTasks } from "./order";

/** On-disk shape of the dev data file. Validated on load so a corrupt file fails loudly. */
const Store = z.object({
  version: z.literal(1),
  homes: z.array(Home),
  assets: z.array(Asset),
  issues: z.array(Issue),
  orders: z.array(Order),
  events: z.array(HomeEvent),
  briefs: z.array(ProBriefRow),
  tasks: z.array(Task),
  checkouts: z.array(CheckoutSessionRow),
  idempotency: z.record(z.string(), z.unknown()),
});
type Store = z.infer<typeof Store>;

const emptyStore = (): Store => ({ version: 1, homes: [], assets: [], issues: [], orders: [], events: [], briefs: [], tasks: [], checkouts: [], idempotency: {} });

const clone = <T>(value: T): T => structuredClone(value);

/** Replace the first item `same` matches, or append. */
function upsert<T>(list: T[], item: T, same: (existing: T) => boolean): void {
  const index = list.findIndex(same);
  if (index >= 0) list[index] = item;
  else list.push(item);
}

const RETRYABLE = new Set(["EPERM", "EBUSY", "EACCES"]);

/** Write to a temp file in the same directory, then rename over the target. */
async function writeAtomic(file: string, text: string, tag: number): Promise<void> {
  const tmp = `${file}.${process.pid}.${tag}.tmp`;
  await writeFile(tmp, text, "utf8");
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(tmp, file);
      return;
    } catch (error) {
      // Windows can briefly refuse a rename while antivirus or an indexer holds the target.
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (attempt >= 4 || !RETRYABLE.has(code)) {
        await rm(tmp, { force: true });
        throw error;
      }
      await delay(15 * (attempt + 1));
    }
  }
}

/**
 * Dev-default repository: the whole graph lives in one JSON file, cached in memory, written
 * atomically after every change (PRD section 8 dev fallback). Reads never touch the disk.
 */
export class MemoryRepo implements HomeRepository {
  private readonly store: Store;
  private chain: Promise<void> = Promise.resolve();
  private writes = 0;

  constructor(private readonly file: string) {
    mkdirSync(dirname(file), { recursive: true });
    if (existsSync(file)) {
      const parsed = Store.safeParse(JSON.parse(readFileSync(file, "utf8")));
      if (!parsed.success) throw new Error(`Home graph data file ${file} is not valid: ${parsed.error.issues[0]?.message ?? "unknown error"}`);
      this.store = parsed.data;
    } else {
      this.store = emptyStore();
    }
  }

  /** Snapshot now, write in order; a failed write rejects its caller but never blocks the next one. */
  private persist(): Promise<void> {
    const snapshot = JSON.stringify(this.store);
    const tag = this.writes++;
    const run = this.chain.then(() => writeAtomic(this.file, snapshot, tag));
    this.chain = run.catch(() => undefined);
    return run;
  }

  async getHomeForUser(userId: string): Promise<Home | null> {
    const home = this.store.homes.find((h) => h.userId === userId);
    return home ? clone(home) : null;
  }

  async putHome(home: Home): Promise<void> {
    upsert(this.store.homes, clone(home), (h) => h.userId === home.userId && h.homeId === home.homeId);
    await this.persist();
  }

  async listAssets(homeId: string): Promise<Asset[]> {
    return clone(sortAssets(this.store.assets.filter((a) => a.homeId === homeId)));
  }

  async getAsset(homeId: string, assetId: string): Promise<Asset | null> {
    const asset = this.store.assets.find((a) => a.homeId === homeId && a.assetId === assetId);
    return asset ? clone(asset) : null;
  }

  async putAsset(asset: Asset): Promise<void> {
    upsert(this.store.assets, clone(asset), (a) => a.homeId === asset.homeId && a.assetId === asset.assetId);
    await this.persist();
  }

  async putIssue(issue: Issue): Promise<void> {
    upsert(this.store.issues, clone(issue), (i) => i.homeId === issue.homeId && i.issueRecordId === issue.issueRecordId);
    await this.persist();
  }

  async listIssues(homeId: string, opts?: { status?: Issue["status"] }): Promise<Issue[]> {
    const issues = this.store.issues.filter((i) => i.homeId === homeId && (opts?.status === undefined || i.status === opts.status));
    return clone(sortIssues(issues));
  }

  async putOrder(order: Order): Promise<void> {
    upsert(this.store.orders, clone(order), (o) => o.homeId === order.homeId && o.orderId === order.orderId);
    await this.persist();
  }

  async listOrders(homeId: string): Promise<Order[]> {
    return clone(sortOrders(this.store.orders.filter((o) => o.homeId === homeId)));
  }

  async putEvent(event: HomeEvent): Promise<void> {
    upsert(this.store.events, clone(event), (e) => e.homeId === event.homeId && e.eventId === event.eventId);
    await this.persist();
  }

  async listEvents(homeId: string, opts?: { assetId?: string; type?: EventType; limit?: number }): Promise<HomeEvent[]> {
    return clone(filterEvents(this.store.events.filter((e) => e.homeId === homeId), opts));
  }

  async putBrief(brief: ProBriefRow): Promise<void> {
    upsert(this.store.briefs, clone(brief), (b) => b.homeId === brief.homeId && b.briefId === brief.briefId);
    await this.persist();
  }

  async getBrief(homeId: string, briefId: string): Promise<ProBriefRow | null> {
    const brief = this.store.briefs.find((b) => b.homeId === homeId && b.briefId === briefId);
    return brief ? clone(brief) : null;
  }

  async getBriefByToken(publicToken: string): Promise<ProBriefRow | null> {
    const brief = this.store.briefs.find((b) => b.publicToken === publicToken);
    return brief ? clone(brief) : null;
  }

  async listTasks(homeId: string): Promise<Task[]> {
    return clone(sortTasks(this.store.tasks.filter((t) => t.homeId === homeId)));
  }

  async putTask(task: Task): Promise<void> {
    upsert(this.store.tasks, clone(task), (t) => t.homeId === task.homeId && t.taskId === task.taskId);
    await this.persist();
  }

  async putCheckoutSession(row: CheckoutSessionRow): Promise<void> {
    upsert(this.store.checkouts, clone(row), (c) => c.homeId === row.homeId && c.sessionId === row.sessionId);
    await this.persist();
  }

  async getCheckoutSession(homeId: string, sessionId: string): Promise<CheckoutSessionRow | null> {
    const row = this.store.checkouts.find((c) => c.homeId === homeId && c.sessionId === sessionId);
    return row ? clone(row) : null;
  }

  async getIdempotent(userId: string, key: string): Promise<unknown | null> {
    const stored = this.store.idempotency[`${userId}\u0000${key}`];
    return stored === undefined ? null : clone(stored);
  }

  async putIdempotent(userId: string, key: string, result: unknown): Promise<void> {
    this.store.idempotency[`${userId}\u0000${key}`] = clone(result) ?? null;
    await this.persist();
  }
}
