import { mkdtemp, rm } from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTweedyMastra } from "..";
import { ensureExperimentDataset } from "./dataset";
import { seedExperimentDataset } from "./dataset-items";
import { PodcastScript, Speaker, SpeakerAllocation } from "../../types";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

function stubSpeaker(id: string): Speaker {
  return {
    id,
    name: id,
    personality: "curious",
    voiceId: "voice-1",
  } as unknown as Speaker;
}

function stubScript(overrides: Partial<PodcastScript> = {}): PodcastScript {
  return {
    id: "script-1",
    title: "Test Episode",
    description: "A test episode",
    speakers: [stubSpeaker("alice"), stubSpeaker("bob")],
    speeches: [],
    materials: [],
    discussionPoints: [],
    ...overrides,
  } as PodcastScript;
}

describe("dataset-driven experiment run", () => {
  it("runs every seeded item through the registered workflow and scores it", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tweedy-dataset-run-"));
    tempDirs.push(dir);
    const resultScript = stubScript({
      speeches: [{ speaker: { id: "alice" }, message: "Hi" } as any],
    });
    const runner = { run: vi.fn().mockResolvedValue(resultScript) };
    const loadScript = vi.fn().mockResolvedValue(stubScript());

    const { mastra } = createTweedyMastra({
      storagePath: path.join(dir, "store.db"),
      tracePath: path.join(dir, "traces.jsonl"),
      experimentWorkflowDependencies: { runner, loadScript },
    });

    const dataset = await ensureExperimentDataset(mastra);
    await seedExperimentDataset(dataset, "script-1");

    const summary = await dataset.startExperiment({
      name: "test-run",
      targetType: "workflow",
      targetId: "episodeExperimentRun",
      scorers: ["rejection-repair-rate"],
    });

    expect(summary.status).toBe("completed");
    expect(summary.succeededCount).toBe(6);
    expect(summary.results[0].scores[0].scorerName).toBe("rejection-repair-rate");
    expect(runner.run).toHaveBeenCalledTimes(6);
  });
});
