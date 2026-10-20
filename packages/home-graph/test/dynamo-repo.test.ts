import { DynamoRepo, defaultSender, senderFor } from "../src/dynamo-repo";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { describe, expect, it, vi } from "vitest";
import { FakeDoc } from "./fake-doc";
import { HOME, USER, asset, brief, checkout, event, home, issue, order, task } from "./fixtures";
import { repoContract } from "./repo-contract";

repoContract("DynamoRepo (fake document client)", async () => new DynamoRepo("hearth-test", new FakeDoc()));
repoContract("DynamoRepo (one item per page)", async () => new DynamoRepo("hearth-test", new FakeDoc("hearth-test", 1)));

describe("DynamoRepo single-table keys (PRD section 8)", () => {
  it("writes every entity under the exact PK and SK strings", async () => {
    const doc = new FakeDoc();
    const repo = new DynamoRepo("hearth-test", doc);
    await repo.putHome(home());
    await repo.putAsset(asset("asset_a"));
    await repo.putIssue(issue("iss_1", "2026-10-21T10:00:00-05:00"));
    await repo.putOrder(order("ord_1", "2026-10-21T11:00:00-05:00"));
    await repo.putEvent(event("evt_1", "2026-10-21T12:00:00-05:00", { assetId: "asset_a" }));
    await repo.putEvent(event("evt_2", "2026-10-21T13:00:00-05:00"));
    await repo.putBrief(brief("brief_1", "tok_1"));
    await repo.putTask(task("task_1", "2026-10-24"));
    await repo.putCheckoutSession(checkout("cs_1"));
    await repo.putIdempotent(USER, "key-1", { ok: true });

    expect(doc.keys()).toEqual(
      [
        `USER#${USER} | HOME#${HOME}`,
        `HOME#${HOME} | ASSET#asset_a`,
        `HOME#${HOME} | ISSUE#2026-10-21T10:00:00-05:00#iss_1`,
        `HOME#${HOME} | ORDER#2026-10-21T11:00:00-05:00#ord_1`,
        `HOME#${HOME} | EVENT#2026-10-21T12:00:00-05:00#evt_1`,
        `HOME#${HOME} | EVENT#2026-10-21T13:00:00-05:00#evt_2`,
        `HOME#${HOME} | BRIEF#brief_1`,
        "TOKEN#tok_1 | BRIEF",
        `HOME#${HOME} | TASK#2026-10-24#task_1`,
        `HOME#${HOME} | CHECKOUT#cs_1`,
        `IDEM#${USER} | KEY#key-1`,
      ].sort(),
    );
  });

  it("indexes events by asset on GSI1 and leaves asset-less events out", async () => {
    const doc = new FakeDoc();
    const repo = new DynamoRepo("hearth-test", doc);
    await repo.putEvent(event("evt_1", "2026-10-21T12:00:00-05:00", { assetId: "asset_a" }));
    await repo.putEvent(event("evt_2", "2026-10-21T13:00:00-05:00"));
    expect(doc.find(`HOME#${HOME}`, "EVENT#2026-10-21T12:00:00-05:00#evt_1")).toMatchObject({
      GSI1PK: "ASSET#asset_a",
      GSI1SK: "EVENT#2026-10-21T12:00:00-05:00",
      entity: "EVENT",
    });
    expect(doc.find(`HOME#${HOME}`, "EVENT#2026-10-21T13:00:00-05:00#evt_2")).not.toHaveProperty("GSI1PK");
  });

  it("reads per-asset history from GSI1 in one query, not a scan of the home", async () => {
    const doc = new FakeDoc("hearth-test", 50);
    const repo = new DynamoRepo("hearth-test", doc);
    await repo.putEvent(event("evt_1", "2026-10-21T12:00:00-05:00", { assetId: "asset_a" }));
    doc.calls.length = 0;
    expect(await repo.listEvents(HOME, { assetId: "asset_a" })).toHaveLength(1);
    expect(doc.calls).toEqual(["query"]);
  });

  it("resolves a shared brief with two reads through the token pointer", async () => {
    const doc = new FakeDoc();
    const repo = new DynamoRepo("hearth-test", doc);
    await repo.putBrief(brief("brief_1", "tok_1"));
    expect(doc.find("TOKEN#tok_1", "BRIEF")).toMatchObject({ homeId: HOME, briefId: "brief_1" });
    doc.calls.length = 0;
    expect((await repo.getBriefByToken("tok_1"))?.briefId).toBe("brief_1");
    expect(doc.calls).toEqual(["get", "get"]);
  });

  it("removes the old item when an id moves to a new sort key", async () => {
    const doc = new FakeDoc();
    const repo = new DynamoRepo("hearth-test", doc);
    await repo.putTask(task("task_1", "2026-12-01"));
    await repo.putTask(task("task_1", "2026-11-01"));
    expect(doc.keys().filter((k) => k.includes("TASK#"))).toEqual([`HOME#${HOME} | TASK#2026-11-01#task_1`]);
    expect(doc.calls).toContain("delete");
  });

  it("does not delete anything on a plain upsert", async () => {
    const doc = new FakeDoc();
    const repo = new DynamoRepo("hearth-test", doc);
    await repo.putTask(task("task_1", "2026-12-01"));
    await repo.putTask(task("task_1", "2026-12-01", { done: true }));
    expect(doc.calls).not.toContain("delete");
    expect((await repo.listTasks(HOME))[0]?.done).toBe(true);
  });

  it("strips storage attributes from what it returns", async () => {
    const doc = new FakeDoc();
    const repo = new DynamoRepo("hearth-test", doc);
    await repo.putHome(home());
    await repo.putAsset(asset("asset_a"));
    expect(await repo.getHomeForUser(USER)).toEqual(home());
    expect(Object.keys((await repo.getAsset(HOME, "asset_a"))!)).not.toContain("PK");
    expect(Object.keys((await repo.getAsset(HOME, "asset_a"))!)).not.toContain("entity");
  });
});

describe("DynamoRepo construction", () => {
  it("builds a real document client sender without touching the network", () => {
    const sender = defaultSender();
    expect(typeof sender.send).toBe("function");
  });

  it("adapts the SDK document client", async () => {
    const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));
    const send = vi.spyOn(doc, "send").mockImplementation((async () => ({ Item: { PK: "a", SK: "b" } })) as never);
    const result = await senderFor(doc).send(new GetCommand({ TableName: "t", Key: { PK: "a", SK: "b" } }));
    expect(result.Item).toEqual({ PK: "a", SK: "b" });
    expect(send).toHaveBeenCalledOnce();
  });

  it("uses the default sender when none is injected", () => {
    expect(new DynamoRepo("hearth-test")).toBeInstanceOf(DynamoRepo);
  });
});
