import { mkdtemp, rm } from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTweedyMastra } from "..";
import { InMemoryTraceSink } from "../tracing";
import { ensureExperimentDataset, EXPERIMENT_DATASET_NAME } from "./dataset";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

async function storagePath(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tweedy-dataset-"));
  tempDirs.push(dir);
  return path.join(dir, "store.db");
}

describe("ensureExperimentDataset", () => {
  it("creates the dataset on first call", async () => {
    const { mastra } = createTweedyMastra({
      storagePath: await storagePath(),
      traceSink: new InMemoryTraceSink(),
      experimentWorkflowDependencies: { runner: { run: vi.fn() }, loadScript: vi.fn() },
    });

    const dataset = await ensureExperimentDataset(mastra);

    expect(dataset.id).toBeDefined();
    const { datasets } = await mastra.datasets.list();
    expect(datasets.filter((d) => d.name === EXPERIMENT_DATASET_NAME)).toHaveLength(1);

    const details = await dataset.getDetails();
    expect(details.targetType).toBe("workflow");
    expect(details.targetIds).toEqual(["episodeExperimentRun"]);
    expect(details.scorerIds).toEqual(["transcript-quality", "rejection-repair-rate"]);
    expect(details.inputSchema).toBeDefined();
  });

  it("returns the existing dataset on a second call instead of creating a duplicate", async () => {
    const { mastra } = createTweedyMastra({
      storagePath: await storagePath(),
      traceSink: new InMemoryTraceSink(),
      experimentWorkflowDependencies: { runner: { run: vi.fn() }, loadScript: vi.fn() },
    });

    const first = await ensureExperimentDataset(mastra);
    const second = await ensureExperimentDataset(mastra);

    expect(second.id).toBe(first.id);
    const { datasets } = await mastra.datasets.list();
    expect(datasets.filter((d) => d.name === EXPERIMENT_DATASET_NAME)).toHaveLength(1);
  });

  it("resolves to the same dataset when called concurrently", async () => {
    const { mastra } = createTweedyMastra({
      storagePath: await storagePath(),
      traceSink: new InMemoryTraceSink(),
      experimentWorkflowDependencies: { runner: { run: vi.fn() }, loadScript: vi.fn() },
    });

    const [first, second] = await Promise.all([
      ensureExperimentDataset(mastra),
      ensureExperimentDataset(mastra),
    ]);

    expect(second.id).toBe(first.id);
    const { datasets } = await mastra.datasets.list();
    expect(datasets.filter((d) => d.name === EXPERIMENT_DATASET_NAME)).toHaveLength(1);
  });
});
