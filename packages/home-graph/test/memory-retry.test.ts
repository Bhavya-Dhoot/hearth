import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { asset } from "./fixtures";

const mocks = vi.hoisted(() => ({ rename: vi.fn() }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: (...args: Parameters<typeof actual.rename>) => mocks.rename(actual.rename, ...args) };
});

const { MemoryRepo } = await import("../src/memory-repo");

const root = mkdtempSync(join(tmpdir(), "hearth-home-graph-retry-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const failure = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code });

describe("atomic write rename", () => {
  beforeEach(() => {
    mocks.rename.mockReset();
  });

  it("retries a transient EPERM and then succeeds", async () => {
    let attempts = 0;
    mocks.rename.mockImplementation(async (real: (a: string, b: string) => Promise<void>, from: string, to: string) => {
      if (++attempts <= 2) throw failure("EPERM");
      return real(from, to);
    });
    const file = join(root, "retry", "home-graph.json");
    await new MemoryRepo(file).putAsset(asset("asset_a"));
    expect(attempts).toBe(3);
    expect(existsSync(file)).toBe(true);
  });

  it("gives up on a permanent error and removes the temp file", async () => {
    mocks.rename.mockImplementation(async () => {
      throw failure("ENOSPC");
    });
    const file = join(root, "permanent", "home-graph.json");
    await expect(new MemoryRepo(file).putAsset(asset("asset_a"))).rejects.toThrow("ENOSPC");
    expect(mocks.rename).toHaveBeenCalledTimes(1);
    expect(existsSync(file)).toBe(false);
    expect(existsSync(join(root, "permanent", `home-graph.json.${process.pid}.0.tmp`))).toBe(false);
  });

  it("stops retrying after five attempts", async () => {
    mocks.rename.mockImplementation(async () => {
      throw failure("EBUSY");
    });
    const file = join(root, "busy", "home-graph.json");
    await expect(new MemoryRepo(file).putAsset(asset("asset_a"))).rejects.toThrow("EBUSY");
    expect(mocks.rename).toHaveBeenCalledTimes(5);
  });
});
