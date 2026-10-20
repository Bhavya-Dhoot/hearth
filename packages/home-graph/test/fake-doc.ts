import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { DocResult, DocSender } from "../src/dynamo-repo";

type Item = Record<string, unknown>;

/**
 * A small in-memory stand-in for DynamoDB behind DocSender: Put, Get, Delete and Query with the
 * exact expressions DynamoRepo uses (key condition with begins_with, one equality filter,
 * projection, GSI1, ScanIndexForward, pagination). No network.
 */
export class FakeDoc implements DocSender {
  readonly items = new Map<string, Item>();
  readonly calls: string[] = [];

  constructor(
    private readonly table = "hearth-test",
    private readonly pageSize = 2,
  ) {}

  private key(pk: unknown, sk: unknown): string {
    return `${String(pk)}\u0000${String(sk)}`;
  }

  find(pk: string, sk: string): Item | undefined {
    return this.items.get(this.key(pk, sk));
  }

  keys(): string[] {
    return [...this.items.values()].map((i) => `${String(i.PK)} | ${String(i.SK)}`).sort();
  }

  async send(command: GetCommand | PutCommand | QueryCommand | DeleteCommand): Promise<DocResult> {
    const input = command.input as Item;
    if (input.TableName !== this.table) throw new Error(`wrong table ${String(input.TableName)}`);

    if (command instanceof PutCommand) {
      this.calls.push("put");
      const item = structuredClone(command.input.Item) as Item;
      this.items.set(this.key(item.PK, item.SK), item);
      return {};
    }
    if (command instanceof GetCommand) {
      this.calls.push("get");
      const k = command.input.Key as Item;
      const found = this.items.get(this.key(k.PK, k.SK));
      return { Item: found ? structuredClone(found) : undefined };
    }
    if (command instanceof DeleteCommand) {
      this.calls.push("delete");
      const k = command.input.Key as Item;
      this.items.delete(this.key(k.PK, k.SK));
      return {};
    }
    this.calls.push("query");
    return this.query(command.input as Item);
  }

  private query(input: Item): DocResult {
    const values = input.ExpressionAttributeValues as Item;
    const names = (input.ExpressionAttributeNames ?? {}) as Record<string, string>;
    const onIndex = input.IndexName === "GSI1";
    if (input.IndexName !== undefined && !onIndex) throw new Error(`unknown index ${String(input.IndexName)}`);
    const pkAttr = onIndex ? "GSI1PK" : "PK";
    const skAttr = onIndex ? "GSI1SK" : "SK";
    const expectedCondition = `${pkAttr} = :pk AND begins_with(${skAttr}, :sk)`;
    if (input.KeyConditionExpression !== expectedCondition) throw new Error(`unexpected key condition ${String(input.KeyConditionExpression)}`);

    let rows = [...this.items.values()]
      .filter((i) => i[pkAttr] === values[":pk"] && typeof i[skAttr] === "string" && (i[skAttr] as string).startsWith(values[":sk"] as string))
      .sort((a, b) => (a[skAttr] as string).localeCompare(b[skAttr] as string));
    if (input.FilterExpression !== undefined) {
      if (input.FilterExpression !== "#id = :id") throw new Error(`unexpected filter ${String(input.FilterExpression)}`);
      rows = rows.filter((i) => i[names["#id"]!] === values[":id"]);
    }
    if (input.ScanIndexForward === false) rows.reverse();

    const start = input.ExclusiveStartKey as Item | undefined;
    const from = start ? rows.findIndex((r) => r.PK === start.PK && r.SK === start.SK) + 1 : 0;
    const page = rows.slice(from, from + this.pageSize);
    const more = from + this.pageSize < rows.length;
    const last = page[page.length - 1];
    const project = (i: Item): Item => (input.ProjectionExpression === "PK, SK" ? { PK: i.PK, SK: i.SK } : structuredClone(i));
    return { Items: page.map(project), ...(more && last ? { LastEvaluatedKey: { PK: last.PK, SK: last.SK } } : {}) };
  }
}
