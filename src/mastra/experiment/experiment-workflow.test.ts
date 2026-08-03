import { mkdtemp, rm } from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Mastra } from "@mastra/core/mastra";
import { LibSQLStore } from "@mastra/libsql";
import { createExperimentWorkflow } from "./experiment-workflow";
import { AiProviderName, PodcastScript, Speaker, SpeakerAllocation } from "../../types";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

async function storagePath(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tweedy-experiment-workflow-"));
  tempDirs.push(dir);
  return path.join(dir, "store.db");
}

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

describe("createExperimentWorkflow", () => {
  it("loads the script, runs it through the injected runner, and returns the transcript", async () => {
    const resultScript = stubScript({
      speeches: [
        { speaker: { id: "alice" }, message: "Welcome!" } as any,
        { speaker: { id: "bob" }, message: "Thanks for having me." } as any,
      ],
    });
    const runner = { run: vi.fn().mockResolvedValue(resultScript) };
    const loadScript = vi.fn().mockResolvedValue(stubScript());

    const workflow = createExperimentWorkflow({ runner, loadScript });
    const mastra = new Mastra({
      storage: new LibSQLStore({ id: "test-store", url: `file:${await storagePath()}` }),
      workflows: { episodeExperimentRun: workflow },
    });

    const run = await mastra.getWorkflow("episodeExperimentRun").createRun({});
    const result = await run.start({
      inputData: { scriptId: "script-1", maxTurns: 8, maxDurationSeconds: 240 },
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error("expected success");
    expect(result.result.episodeId).toBe("script-1");
    expect(typeof result.result.runId).toBe("string");
    expect(result.result.transcript).toEqual([
      { speakerId: "alice", message: "Welcome!" },
      { speakerId: "bob", message: "Thanks for having me." },
    ]);

    expect(loadScript).toHaveBeenCalledWith("script-1");
    expect(runner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          maxTurns: 8,
          maxDuration: 240,
          allocation: SpeakerAllocation.Managed,
        }),
      })
    );
  });

  it("applies guidanceOverride and provider from the input instead of the stored script's guidance", async () => {
    const resultScript = stubScript({ guidance: "stored guidance" });
    const runner = { run: vi.fn().mockResolvedValue(resultScript) };
    const loadScript = vi
      .fn()
      .mockResolvedValue(stubScript({ guidance: "stored guidance" }));

    const workflow = createExperimentWorkflow({ runner, loadScript });
    const mastra = new Mastra({
      storage: new LibSQLStore({ id: "test-store", url: `file:${await storagePath()}` }),
      workflows: { episodeExperimentRun: workflow },
    });

    const run = await mastra.getWorkflow("episodeExperimentRun").createRun({});
    await run.start({
      inputData: {
        scriptId: "script-1",
        maxTurns: 8,
        maxDurationSeconds: 240,
        provider: AiProviderName.OpenAI,
        guidanceOverride: "sweep this guidance instead",
        directorPromptVariantId: "director-variant",
        speakerPromptVariantId: "speaker-variant",
      },
    });

    expect(runner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          guidance: "sweep this guidance instead",
          provider: AiProviderName.OpenAI,
          directorPromptVariantId: "director-variant",
          speakerPromptVariantId: "speaker-variant",
        }),
      })
    );
  });
});
