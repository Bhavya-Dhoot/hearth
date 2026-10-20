import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { DynamoRepo, MemoryRepo, createRepo } from "../src";
import { HOME, USER, asset, event, home, task } from "./fixtures";
import { repoContract } from "./repo-contract";

const root = mkdtempSync(join(tmpdir(), "hearth-home-graph-"));
let counter = 0;
const freshFile = (): string => join(root, `case-${counter++}`, "home-graph.json");

afterAll(() => rmSync(root, { recursive: true, force: true }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

repoContract("MemoryRepo", async () => new MemoryRepo(freshFile()));

describe("MemoryRepo persistence", () => {
  it("writes the graph to the JSON file and reloads it in a new instance", async () => {
    const file = freshFile();
    const first = new MemoryRepo(file);
    await first.putHome(home());
    await first.putAsset(asset("asset_a"));
    await first.putEvent(event("evt_1", "2026-10-21T12:00:00-05:00", { assetId: "asset_a" }));
    await first.putTask(task("task_1", "2026-10-24"));
    await first.putIdempotent(USER, "key-1", { ok: true });

    const second = new MemoryRepo(file);
    expect(await second.getHomeForUser(USER)).toEqual(home());
    expect((await second.listAssets(HOME)).map((a) => a.assetId)).toEqual(["asset_a"]);
    expect(await second.listEvents(HOME)).toHaveLength(1);
    expect(await second.listTasks(HOME)).toHaveLength(1);
    expect(await second.getIdempotent(USER, "key-1")).toEqual({ ok: true });
  });

  it("creates the data directory and starts empty when the file does not exist", async () => {
    const file = freshFile();
    const repo = new MemoryRepo(file);
    expect(existsSync(file)).toBe(false);
    expect(await repo.listAssets(HOME)).toEqual([]);
    await repo.putAsset(asset("asset_a"));
    expect(existsSync(file)).toBe(true);
  });

  it("leaves no temp files behind and always leaves valid JSON", async () => {
    const file = freshFile();
    const repo = new MemoryRepo(file);
    await Promise.all(Array.from({ length: 25 }, (_, i) => repo.putAsset(asset(`asset_${i}`))));
    expect(readdirSync(join(file, ".."))).toEqual(["home-graph.json"]);
    const onDisk = JSON.parse(readFileSync(file, "utf8")) as { version: number; assets: unknown[] };
    expect(onDisk.version).toBe(1);
    expect(onDisk.assets).toHaveLength(25);
  });

  it("keeps the writes in order when many arrive at once", async () => {
    const file = freshFile();
    const repo = new MemoryRepo(file);
    await Promise.all([1, 2, 3, 4, 5].map((n) => repo.putTask(task("task_1", "2026-10-24", { title: `version ${n}` }))));
    expect((await new MemoryRepo(file).listTasks(HOME))[0]?.title).toBe("version 5");
  });

  it("rejects the failed write, then recovers on the next one", async () => {
    const file = freshFile();
    const repo = new MemoryRepo(file);
    rmSync(join(file, ".."), { recursive: true, force: true });
    await expect(repo.putAsset(asset("asset_a"))).rejects.toThrow();
    await mkdir(join(file, ".."), { recursive: true });
    await repo.putAsset(asset("asset_b"));
    expect((await new MemoryRepo(file).listAssets(HOME)).map((a) => a.assetId).sort()).toEqual(["asset_a", "asset_b"]);
  });

  it("fails loudly on a corrupt or foreign data file", () => {
    const corrupt = freshFile();
    new MemoryRepo(corrupt);
    writeFileSync(corrupt, "{not json");
    expect(() => new MemoryRepo(corrupt)).toThrow();

    const foreign = freshFile();
    new MemoryRepo(foreign);
    writeFileSync(foreign, JSON.stringify({ version: 2, homes: [] }));
    expect(() => new MemoryRepo(foreign)).toThrow(/is not valid/);
  });
});

describe("createRepo", () => {
  it("returns a MemoryRepo for an explicit data file, even with a table in the environment", async () => {
    vi.stubEnv("HEARTH_DDB_TABLE", "hearth-home-graph");
    const file = freshFile();
    const repo = createRepo({ dataFile: file });
    expect(repo).toBeInstanceOf(MemoryRepo);
    await repo.putHome(home());
    expect(existsSync(file)).toBe(true);
  });

  it("returns a DynamoRepo for an explicit table name", () => {
    expect(createRepo({ tableName: "hearth-home-graph" })).toBeInstanceOf(DynamoRepo);
  });

  it("returns a DynamoRepo when HEARTH_DDB_TABLE is set", () => {
    vi.stubEnv("HEARTH_DDB_TABLE", "hearth-home-graph");
    expect(createRepo()).toBeInstanceOf(DynamoRepo);
  });

  it("falls back to HEARTH_DATA_FILE", async () => {
    vi.stubEnv("HEARTH_DDB_TABLE", "");
    const file = freshFile();
    vi.stubEnv("HEARTH_DATA_FILE", file);
    const repo = createRepo();
    expect(repo).toBeInstanceOf(MemoryRepo);
    await repo.putHome(home());
    expect(existsSync(file)).toBe(true);
  });

  it("defaults to .data/home-graph.json under the working directory", async () => {
    vi.stubEnv("HEARTH_DDB_TABLE", "");
    vi.stubEnv("HEARTH_DATA_FILE", "");
    const cwd = join(root, "cwd");
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    const repo = createRepo();
    expect(repo).toBeInstanceOf(MemoryRepo);
    await repo.putHome(home());
    expect(existsSync(join(cwd, ".data", "home-graph.json"))).toBe(true);
  });
});
