import type { HomeRepository } from "@hearth/contracts";
import { describe, expect, it } from "vitest";
import { HOME, USER, asset, brief, checkout, event, home, issue, order, task } from "./fixtures";

/**
 * Behaviour every HomeRepository must share. MemoryRepo and DynamoRepo (on a fake document
 * client) both run it, so the two can never drift apart.
 */
export function repoContract(label: string, make: () => Promise<HomeRepository>): void {
  describe(`${label}: HomeRepository contract`, () => {
    it("stores one home per user and replaces it on put", async () => {
      const repo = await make();
      expect(await repo.getHomeForUser(USER)).toBeNull();
      await repo.putHome(home());
      await repo.putHome(home({ name: "Renamed House" }));
      expect(await repo.getHomeForUser(USER)).toEqual(home({ name: "Renamed House" }));
      expect(await repo.getHomeForUser("usr_other")).toBeNull();
    });

    it("gets, lists and replaces assets, newest first with ties by id", async () => {
      const repo = await make();
      expect(await repo.getAsset(HOME, "asset_a")).toBeNull();
      await repo.putAsset(asset("asset_b", "2026-10-14T09:00:00-05:00"));
      await repo.putAsset(asset("asset_a", "2026-10-14T09:00:00-05:00"));
      await repo.putAsset(asset("asset_new", "2026-10-15T09:00:00-05:00"));
      await repo.putAsset(asset("asset_a", "2026-10-14T09:00:00-05:00", { label: "replaced" }));
      await repo.putAsset({ ...asset("asset_elsewhere"), homeId: "home_other" });
      expect((await repo.listAssets(HOME)).map((a) => a.assetId)).toEqual(["asset_new", "asset_a", "asset_b"]);
      expect((await repo.getAsset(HOME, "asset_a"))?.label).toBe("replaced");
      expect(await repo.getAsset(HOME, "asset_elsewhere")).toBeNull();
    });

    it("keeps photos, attributes and consumables through a round trip", async () => {
      const repo = await make();
      const full = asset("asset_full", undefined, {
        brand: "Carrier", model: "59SC2", installDate: "2014-05-22",
        photos: [{ url: "http://localhost:4200/media/x.svg", alt: "x", annotation: { x: 0.5, y: 0.5, r: 0.1 } }],
        attributes: { filterSize: "16x25x1", merv: 11, fuel: "gas", labelled: true },
        consumables: [{ sku: "HR-FF-162501-M11-2", label: "filter", intervalDays: 90, lastReplaced: "2026-07-19" }],
        recallIds: ["SAMPLE-1"],
      });
      await repo.putAsset(full);
      expect(await repo.getAsset(HOME, "asset_full")).toEqual(full);
    });

    it("lists issues newest first and filters by status", async () => {
      const repo = await make();
      await repo.putIssue(issue("iss_1", "2026-10-01T09:00:00-05:00"));
      await repo.putIssue(issue("iss_2", "2026-10-03T09:00:00-05:00", { status: "escalated" }));
      await repo.putIssue(issue("iss_3", "2026-10-02T09:00:00-05:00", { answers: { source: "pipes" } }));
      await repo.putIssue(issue("iss_1", "2026-10-01T09:00:00-05:00", { status: "resolved", stepsCompleted: 6 }));
      expect((await repo.listIssues(HOME)).map((i) => i.issueRecordId)).toEqual(["iss_2", "iss_3", "iss_1"]);
      expect((await repo.listIssues(HOME, { status: "resolved" })).map((i) => i.issueRecordId)).toEqual(["iss_1"]);
      expect(await repo.listIssues(HOME, { status: "open" })).toHaveLength(1);
      expect((await repo.listIssues(HOME))[1]?.answers).toEqual({ source: "pipes" });
      expect(await repo.listIssues("home_other")).toEqual([]);
    });

    it("lists orders newest first", async () => {
      const repo = await make();
      await repo.putOrder(order("ord_1", "2026-10-01T09:00:00-05:00"));
      await repo.putOrder(order("ord_2", "2026-10-05T09:00:00-05:00"));
      expect((await repo.listOrders(HOME)).map((o) => o.orderId)).toEqual(["ord_2", "ord_1"]);
      expect(await repo.listOrders("home_other")).toEqual([]);
    });

    it("lists events newest first with asset, type and limit filters", async () => {
      const repo = await make();
      await repo.putEvent(event("evt_1", "2026-04-20T09:00:00-05:00", { assetId: "asset_furnace" }));
      await repo.putEvent(event("evt_2", "2026-07-19T09:00:00-05:00", { assetId: "asset_furnace" }));
      await repo.putEvent(event("evt_3", "2025-05-08T18:00:00-05:00", { assetId: "asset_disposal", type: "repair", cost: 0 }));
      await repo.putEvent(event("evt_4", "2026-08-01T09:00:00-05:00", { type: "order" }));
      await repo.putEvent({ ...event("evt_5", "2026-09-01T09:00:00-05:00", { assetId: "asset_furnace" }), homeId: "home_other" });
      const ids = (events: { eventId: string }[]) => events.map((e) => e.eventId);
      expect(ids(await repo.listEvents(HOME))).toEqual(["evt_4", "evt_2", "evt_1", "evt_3"]);
      expect(ids(await repo.listEvents(HOME, { assetId: "asset_furnace" }))).toEqual(["evt_2", "evt_1"]);
      expect(ids(await repo.listEvents(HOME, { type: "repair" }))).toEqual(["evt_3"]);
      expect(ids(await repo.listEvents(HOME, { assetId: "asset_furnace", type: "maintenance", limit: 1 }))).toEqual(["evt_2"]);
      expect(ids(await repo.listEvents(HOME, { limit: 2 }))).toEqual(["evt_4", "evt_2"]);
      expect(await repo.listEvents(HOME, { limit: 0 })).toEqual([]);
      expect(await repo.listEvents(HOME, { assetId: "asset_missing" })).toEqual([]);
      expect(await repo.listEvents("home_empty")).toEqual([]);
    });

    it("keeps an event unique when its timestamp changes", async () => {
      const repo = await make();
      await repo.putEvent(event("evt_1", "2026-04-20T09:00:00-05:00", { assetId: "asset_furnace" }));
      await repo.putEvent(event("evt_1", "2026-05-01T09:00:00-05:00", { assetId: "asset_furnace", summary: "moved" }));
      const all = await repo.listEvents(HOME);
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({ ts: "2026-05-01T09:00:00-05:00", summary: "moved" });
      expect(await repo.listEvents(HOME, { assetId: "asset_furnace" })).toHaveLength(1);
    });

    it("stores briefs and resolves them by public token", async () => {
      const repo = await make();
      expect(await repo.getBrief(HOME, "brief_1")).toBeNull();
      expect(await repo.getBriefByToken("tok_1")).toBeNull();
      await repo.putBrief(brief("brief_1", "tok_1"));
      await repo.putBrief(brief("brief_2", "tok_2"));
      expect(await repo.getBrief(HOME, "brief_1")).toEqual(brief("brief_1", "tok_1"));
      expect(await repo.getBrief("home_other", "brief_1")).toBeNull();
      expect((await repo.getBriefByToken("tok_2"))?.briefId).toBe("brief_2");
      expect(await repo.getBriefByToken("tok_unknown")).toBeNull();
    });

    it("sorts tasks by due date ascending and keeps a task unique when its date changes", async () => {
      const repo = await make();
      await repo.putTask(task("task_b", "2026-10-24"));
      await repo.putTask(task("task_a", "2026-10-17", { assetId: "asset_furnace", kind: "consumable", reorderSku: "HR-FF-162501-M11-2" }));
      await repo.putTask(task("task_c", "2026-10-24"));
      await repo.putTask(task("task_d", "2026-12-01"));
      await repo.putTask(task("task_d", "2026-11-01", { done: true }));
      const tasks = await repo.listTasks(HOME);
      expect(tasks.map((t) => t.taskId)).toEqual(["task_a", "task_b", "task_c", "task_d"]);
      expect(tasks[3]).toMatchObject({ dueDate: "2026-11-01", done: true });
      expect(tasks[0]?.reorderSku).toBe("HR-FF-162501-M11-2");
      expect(await repo.listTasks("home_other")).toEqual([]);
    });

    it("stores checkout sessions and replaces them on update", async () => {
      const repo = await make();
      expect(await repo.getCheckoutSession(HOME, "cs_1")).toBeNull();
      await repo.putCheckoutSession(checkout("cs_1"));
      await repo.putCheckoutSession(checkout("cs_1", { status: "completed", orderId: "ord_1" }));
      expect(await repo.getCheckoutSession(HOME, "cs_1")).toMatchObject({ status: "completed", orderId: "ord_1" });
      expect(await repo.getCheckoutSession("home_other", "cs_1")).toBeNull();
    });

    it("remembers idempotent results per user and key", async () => {
      const repo = await make();
      expect(await repo.getIdempotent(USER, "key-1")).toBeNull();
      await repo.putIdempotent(USER, "key-1", { orderId: "ord_1", nested: { n: 1 } });
      expect(await repo.getIdempotent(USER, "key-1")).toEqual({ orderId: "ord_1", nested: { n: 1 } });
      expect(await repo.getIdempotent(USER, "key-2")).toBeNull();
      expect(await repo.getIdempotent("usr_other", "key-1")).toBeNull();
      await repo.putIdempotent(USER, "key-1", { orderId: "ord_2" });
      expect(await repo.getIdempotent(USER, "key-1")).toEqual({ orderId: "ord_2" });
      await repo.putIdempotent(USER, "key-3", undefined);
      expect(await repo.getIdempotent(USER, "key-3")).toBeNull();
    });

    it("hands out copies that cannot corrupt the store", async () => {
      const repo = await make();
      await repo.putAsset(asset("asset_a"));
      const first = (await repo.getAsset(HOME, "asset_a"))!;
      first.label = "mutated";
      first.attributes.x = 1;
      expect((await repo.getAsset(HOME, "asset_a"))?.label).toBe("thing asset_a");
      expect((await repo.listAssets(HOME))[0]?.attributes).toEqual({});
    });
  });
}
