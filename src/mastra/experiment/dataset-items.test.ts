import { mkdtemp, rm, utimes, writeFile } from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveScriptId, seedExperimentDataset } from "./dataset-items";

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
});
