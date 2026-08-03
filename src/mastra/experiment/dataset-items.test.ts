import { mkdtemp, rm, utimes, writeFile } from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveScriptId, seedExperimentDataset } from "./dataset-items";
import { createTweedyMastra } from "..";
import { ensureExperimentDataset } from "./dataset";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

describe("resolveScriptId", () => {
  it("returns the explicit id unchanged when provided", async () => {
    const result = await resolveScriptId("/does/not/matter", "explicit-id");
    expect(result).toBe("explicit-id");
  });

  it("throws when the scripts directory has no scripts", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tweedy-scripts-empty-"));
    tempDirs.push(dir);
    await expect(resolveScriptId(dir)).rejects.toThrow(/No scripts found/);
  });

  it("picks the most recently modified script when no explicit id is given", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tweedy-scripts-"));
    tempDirs.push(dir);
    await writeFile(path.join(dir, "older.json"), "{}", "utf8");
    await writeFile(path.join(dir, "newer.json"), "{}", "utf8");
    const now = new Date();
    await utimes(path.join(dir, "older.json"), now, new Date(now.getTime() - 60_000));
    await utimes(path.join(dir, "newer.json"), now, now);

    const result = await resolveScriptId(dir);
    expect(result).toBe("newer");
  });
});

describe("seedExperimentDataset", () => {
  it("adds one item per parameter set, repeated twice, all carrying the given scriptId", async () => {
    const addItems = vi.fn().mockResolvedValue([]);
    const dataset = { addItems } as any;

    await seedExperimentDataset(dataset, "script-1");

    expect(addItems).toHaveBeenCalledTimes(1);
    const { items } = addItems.mock.calls[0][0];
    expect(items).toHaveLength(6); // 3 parameter sets x 2 repeats
    for (const item of items) {
      expect(item.input.scriptId).toBe("script-1");
    }
    const maxTurnsSeen = items.map((item: any) => item.input.maxTurns).sort((a: number, b: number) => a - b);
    expect(maxTurnsSeen).toEqual([8, 8, 16, 16, 24, 24]);
  });

  it("gives every item a deterministic, unique externalId derived from scriptId/maxTurns/maxDurationSeconds/repeat", async () => {
    const addItems = vi.fn().mockResolvedValue([]);
    const dataset = { addItems } as any;

    await seedExperimentDataset(dataset, "script-1");
    const { items: firstRunItems } = addItems.mock.calls[0][0];

    addItems.mockClear();
    await seedExperimentDataset(dataset, "script-1");
    const { items: secondRunItems } = addItems.mock.calls[0][0];

    for (const item of firstRunItems) {
      expect(typeof item.externalId).toBe("string");
      expect(item.externalId.length).toBeGreaterThan(0);
    }
    const externalIds = firstRunItems.map((item: any) => item.externalId);
    expect(new Set(externalIds).size).toBe(externalIds.length); // all unique within one run

    // Re-running seed for the same script produces the exact same externalIds
    // in the same order — the precondition for the dataset storage layer to
    // treat the second run as idempotent rather than appending duplicates.
    expect(secondRunItems.map((item: any) => item.externalId)).toEqual(externalIds);
  });

  it("is idempotent against a real dataset: seeding twice for the same script does not double the item count", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tweedy-seed-idempotent-"));
    tempDirs.push(dir);
    const { mastra } = createTweedyMastra({
      storagePath: path.join(dir, "store.db"),
      tracePath: path.join(dir, "traces.jsonl"),
      experimentWorkflowDependencies: { runner: { run: vi.fn() }, loadScript: vi.fn() },
    });
    const dataset = await ensureExperimentDataset(mastra);

    await seedExperimentDataset(dataset, "script-1");
    await seedExperimentDataset(dataset, "script-1");

    const afterSecondSeed = await dataset.listItems();
    const itemsAfterSecondSeed = Array.isArray(afterSecondSeed)
      ? afterSecondSeed
      : afterSecondSeed.items;
    expect(itemsAfterSecondSeed).toHaveLength(6);
  });
});
