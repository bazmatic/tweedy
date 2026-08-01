import { mkdtemp, rm, utimes, writeFile } from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildExperimentItems,
  DEFAULT_RUN_PARAMETER_SETS,
  REPEATS_PER_PARAMETER_SET,
  resolveScriptId,
} from "./dataset-items";

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

describe("buildExperimentItems", () => {
  it("builds one item per parameter set, repeated REPEATS_PER_PARAMETER_SET times", () => {
    const items = buildExperimentItems("script-1");
    expect(items).toHaveLength(
      DEFAULT_RUN_PARAMETER_SETS.length * REPEATS_PER_PARAMETER_SET
    );
    for (const item of items) {
      expect(item.input.scriptId).toBe("script-1");
    }
    const maxTurnsSeen = items.map((item) => item.input.maxTurns).sort((a, b) => a - b);
    const expectedMaxTurns = DEFAULT_RUN_PARAMETER_SETS.flatMap((set) =>
      Array(REPEATS_PER_PARAMETER_SET).fill(set.maxTurns)
    ).sort((a, b) => a - b);
    expect(maxTurnsSeen).toEqual(expectedMaxTurns);
  });
});
