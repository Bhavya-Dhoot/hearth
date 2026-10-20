import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  type QueryCommandInput,
} from "@aws-sdk/lib-dynamodb";
import {
  Asset,
  CheckoutSessionRow,
  Home,
  HomeEvent,
  Issue,
  Keys,
  Order,
  ProBriefRow,
  Task,
  type EventType,
  type HomeRepository,
} from "@hearth/contracts";
import { filterEvents, sortAssets, sortIssues, sortOrders, sortTasks } from "./order";

type Item = Record<string, unknown>;
type Command = GetCommand | PutCommand | QueryCommand | DeleteCommand;

export interface DocResult {
  Item?: Item | undefined;
  Items?: Item[] | undefined;
  LastEvaluatedKey?: Item | undefined;
}

/** The one method the repository needs from a DynamoDBDocumentClient; tests inject a fake. */
export interface DocSender {
  send(command: Command): Promise<DocResult>;
}

/** Adapt the SDK's document client (overloaded `send`) to DocSender. */
export function senderFor(doc: DynamoDBDocumentClient): DocSender {
  return { send: (command) => doc.send(command as GetCommand) as Promise<DocResult> };
}

export function defaultSender(): DocSender {
  return senderFor(DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } }));
}

/** Internal attributes added to every stored item. They are stripped by the zod schemas on read. */
const ENTITY = "entity";

/**
 * Single-table DynamoDB repository (PRD section 8, contracts `Keys`). Entities live under
 * PK/SK exactly as `Keys` builds them; per-asset event history is served by GSI1.
 * Brief public tokens get a small pointer item (PK `TOKEN#<token>`, SK `BRIEF`) so a shared
 * link resolves with two reads and no scan.
 */
export class DynamoRepo implements HomeRepository {
  constructor(
    private readonly table: string,
    private readonly doc: DocSender = defaultSender(),
  ) {}

  private async put(item: Item): Promise<void> {
    await this.doc.send(new PutCommand({ TableName: this.table, Item: item }));
  }

  private async get(key: { PK: string; SK: string }): Promise<Item | undefined> {
    const result = await this.doc.send(new GetCommand({ TableName: this.table, Key: key }));
    return result.Item;
  }

  /** Every item matching `input`, following pagination. */
  private async queryAll(input: Omit<QueryCommandInput, "TableName" | "ExclusiveStartKey">): Promise<Item[]> {
    const items: Item[] = [];
    let startKey: Item | undefined;
    do {
      const page = await this.doc.send(new QueryCommand({ TableName: this.table, ...input, ...(startKey ? { ExclusiveStartKey: startKey } : {}) }));
      items.push(...(page.Items ?? []));
      startKey = page.LastEvaluatedKey;
    } while (startKey);
    return items;
  }

  private partition(homeId: string, prefix: string, extra: Omit<QueryCommandInput, "TableName" | "KeyConditionExpression" | "ExpressionAttributeValues"> = {}): Promise<Item[]> {
    return this.queryAll({
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: { ":pk": `HOME#${homeId}`, ":sk": prefix },
      ...extra,
    });
  }

  /**
   * Put an entity whose sort key embeds a timestamp or due date. If the same id already exists
   * under a different sort key (its date changed), the old item is removed so the id stays unique.
   */
  private async putByIdentity(homeId: string, prefix: string, idAttribute: string, id: string, item: Item): Promise<void> {
    const existing = await this.queryAll({
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      FilterExpression: "#id = :id",
      ExpressionAttributeNames: { "#id": idAttribute },
      ExpressionAttributeValues: { ":pk": `HOME#${homeId}`, ":sk": prefix, ":id": id },
      ProjectionExpression: "PK, SK",
    });
    const stale = existing.filter((e) => e.SK !== item.SK);
    await this.put(item);
    for (const old of stale) await this.doc.send(new DeleteCommand({ TableName: this.table, Key: { PK: old.PK as string, SK: old.SK as string } }));
  }

  async getHomeForUser(userId: string): Promise<Home | null> {
    const [item] = await this.queryAll({
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: { ":pk": `USER#${userId}`, ":sk": "HOME#" },
    });
    return item ? Home.parse(item) : null;
  }

  async putHome(home: Home): Promise<void> {
    await this.put({ ...Keys.home(home.userId, home.homeId), [ENTITY]: "HOME", ...home });
  }

  async listAssets(homeId: string): Promise<Asset[]> {
    return sortAssets((await this.partition(homeId, "ASSET#")).map((item) => Asset.parse(item)));
  }

  async getAsset(homeId: string, assetId: string): Promise<Asset | null> {
    const item = await this.get(Keys.asset(homeId, assetId));
    return item ? Asset.parse(item) : null;
  }

  async putAsset(asset: Asset): Promise<void> {
    await this.put({ ...Keys.asset(asset.homeId, asset.assetId), [ENTITY]: "ASSET", ...asset });
  }

  async putIssue(issue: Issue): Promise<void> {
    const item = { ...Keys.issue(issue.homeId, issue.ts, issue.issueRecordId), [ENTITY]: "ISSUE", ...issue };
    await this.putByIdentity(issue.homeId, "ISSUE#", "issueRecordId", issue.issueRecordId, item);
  }

  async listIssues(homeId: string, opts?: { status?: Issue["status"] }): Promise<Issue[]> {
    const issues = (await this.partition(homeId, "ISSUE#")).map((item) => Issue.parse(item));
    return sortIssues(opts?.status === undefined ? issues : issues.filter((i) => i.status === opts.status));
  }

  async putOrder(order: Order): Promise<void> {
    const item = { ...Keys.order(order.homeId, order.ts, order.orderId), [ENTITY]: "ORDER", ...order };
    await this.putByIdentity(order.homeId, "ORDER#", "orderId", order.orderId, item);
  }

  async listOrders(homeId: string): Promise<Order[]> {
    return sortOrders((await this.partition(homeId, "ORDER#")).map((item) => Order.parse(item)));
  }

  async putEvent(event: HomeEvent): Promise<void> {
    const item = {
      ...Keys.event(event.homeId, event.ts, event.eventId),
      ...(event.assetId !== undefined ? Keys.gsi1Event(event.assetId, event.ts) : {}),
      [ENTITY]: "EVENT",
      ...event,
    };
    await this.putByIdentity(event.homeId, "EVENT#", "eventId", event.eventId, item);
  }

  async listEvents(homeId: string, opts?: { assetId?: string; type?: EventType; limit?: number }): Promise<HomeEvent[]> {
    const items =
      opts?.assetId !== undefined
        ? await this.queryAll({
            IndexName: "GSI1",
            KeyConditionExpression: "GSI1PK = :pk AND begins_with(GSI1SK, :sk)",
            ExpressionAttributeValues: { ":pk": `ASSET#${opts.assetId}`, ":sk": "EVENT#" },
            ScanIndexForward: false,
          })
        : await this.partition(homeId, "EVENT#", { ScanIndexForward: false });
    const events = items.map((item) => HomeEvent.parse(item)).filter((e) => e.homeId === homeId);
    return filterEvents(events, opts);
  }

  async putBrief(brief: ProBriefRow): Promise<void> {
    await this.put({ ...Keys.brief(brief.homeId, brief.briefId), [ENTITY]: "BRIEF", ...brief });
    await this.put({ PK: `TOKEN#${brief.publicToken}`, SK: "BRIEF", [ENTITY]: "BRIEF_TOKEN", homeId: brief.homeId, briefId: brief.briefId });
  }

  async getBrief(homeId: string, briefId: string): Promise<ProBriefRow | null> {
    const item = await this.get(Keys.brief(homeId, briefId));
    return item ? ProBriefRow.parse(item) : null;
  }

  async getBriefByToken(publicToken: string): Promise<ProBriefRow | null> {
    const pointer = await this.get({ PK: `TOKEN#${publicToken}`, SK: "BRIEF" });
    if (!pointer) return null;
    return this.getBrief(pointer.homeId as string, pointer.briefId as string);
  }

  async listTasks(homeId: string): Promise<Task[]> {
    return sortTasks((await this.partition(homeId, "TASK#")).map((item) => Task.parse(item)));
  }

  async putTask(task: Task): Promise<void> {
    const item = { ...Keys.task(task.homeId, task.dueDate, task.taskId), [ENTITY]: "TASK", ...task };
    await this.putByIdentity(task.homeId, "TASK#", "taskId", task.taskId, item);
  }

  async putCheckoutSession(row: CheckoutSessionRow): Promise<void> {
    await this.put({ ...Keys.checkout(row.homeId, row.sessionId), [ENTITY]: "CHECKOUT", ...row });
  }

  async getCheckoutSession(homeId: string, sessionId: string): Promise<CheckoutSessionRow | null> {
    const item = await this.get(Keys.checkout(homeId, sessionId));
    return item ? CheckoutSessionRow.parse(item) : null;
  }

  async getIdempotent(userId: string, key: string): Promise<unknown | null> {
    const item = await this.get(Keys.idem(userId, key));
    return item ? (item.result ?? null) : null;
  }

  async putIdempotent(userId: string, key: string, result: unknown): Promise<void> {
    await this.put({ ...Keys.idem(userId, key), [ENTITY]: "IDEMPOTENCY", result: result ?? null });
  }
}
