import type {
  Asset,
  CheckoutSessionRow,
  EventType,
  Home,
  HomeEvent,
  HomeRepository,
  Issue,
  Order,
  ProBriefRow,
  Task,
} from "@hearth/contracts";

/** Minimal in-memory HomeRepository for tests. Lists are newest-first except tasks (due date ascending). */
export class MemoryRepo implements HomeRepository {
  homes = new Map<string, Home>();
  assets = new Map<string, Asset>();
  issues = new Map<string, Issue>();
  orders = new Map<string, Order>();
  events = new Map<string, HomeEvent>();
  briefs = new Map<string, ProBriefRow>();
  tasks = new Map<string, Task>();
  sessions = new Map<string, CheckoutSessionRow>();
  idem = new Map<string, unknown>();

  async getHomeForUser(userId: string): Promise<Home | null> {
    return this.homes.get(userId) ?? null;
  }
  async putHome(home: Home): Promise<void> {
    this.homes.set(home.userId, home);
  }

  async listAssets(homeId: string): Promise<Asset[]> {
    return [...this.assets.values()].filter((a) => a.homeId === homeId);
  }
  async getAsset(homeId: string, assetId: string): Promise<Asset | null> {
    const a = this.assets.get(assetId);
    return a && a.homeId === homeId ? a : null;
  }
  async putAsset(asset: Asset): Promise<void> {
    this.assets.set(asset.assetId, asset);
  }

  async putIssue(issue: Issue): Promise<void> {
    this.issues.set(issue.issueRecordId, issue);
  }
  async listIssues(homeId: string, opts?: { status?: Issue["status"] }): Promise<Issue[]> {
    return [...this.issues.values()]
      .filter((i) => i.homeId === homeId && (!opts?.status || i.status === opts.status))
      .sort((a, b) => b.ts.localeCompare(a.ts));
  }

  async putOrder(order: Order): Promise<void> {
    this.orders.set(order.orderId, order);
  }
  async listOrders(homeId: string): Promise<Order[]> {
    return [...this.orders.values()].filter((o) => o.homeId === homeId).sort((a, b) => b.ts.localeCompare(a.ts));
  }

  async putEvent(event: HomeEvent): Promise<void> {
    this.events.set(event.eventId, event);
  }
  async listEvents(homeId: string, opts?: { assetId?: string; type?: EventType; limit?: number }): Promise<HomeEvent[]> {
    const all = [...this.events.values()]
      .filter((e) => e.homeId === homeId && (!opts?.assetId || e.assetId === opts.assetId) && (!opts?.type || e.type === opts.type))
      .sort((a, b) => b.ts.localeCompare(a.ts));
    return opts?.limit ? all.slice(0, opts.limit) : all;
  }

  async putBrief(brief: ProBriefRow): Promise<void> {
    this.briefs.set(brief.briefId, brief);
  }
  async getBrief(homeId: string, briefId: string): Promise<ProBriefRow | null> {
    const b = this.briefs.get(briefId);
    return b && b.homeId === homeId ? b : null;
  }
  async getBriefByToken(publicToken: string): Promise<ProBriefRow | null> {
    return [...this.briefs.values()].find((b) => b.publicToken === publicToken) ?? null;
  }

  async listTasks(homeId: string): Promise<Task[]> {
    return [...this.tasks.values()].filter((t) => t.homeId === homeId).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }
  async putTask(task: Task): Promise<void> {
    this.tasks.set(task.taskId, task);
  }

  async putCheckoutSession(row: CheckoutSessionRow): Promise<void> {
    this.sessions.set(row.sessionId, row);
  }
  async getCheckoutSession(homeId: string, sessionId: string): Promise<CheckoutSessionRow | null> {
    const s = this.sessions.get(sessionId);
    return s && s.homeId === homeId ? s : null;
  }

  async getIdempotent(userId: string, key: string): Promise<unknown | null> {
    return this.idem.get(`${userId}|${key}`) ?? null;
  }
  async putIdempotent(userId: string, key: string, result: unknown): Promise<void> {
    this.idem.set(`${userId}|${key}`, JSON.parse(JSON.stringify(result)) as unknown);
  }
}
