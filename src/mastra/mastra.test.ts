import { mkdtemp, readFile } from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { AiProviderName } from "../types";
import { ModelTask } from "../providers/ModelRoutingPolicy";
import { createTweedyMastra } from ".";
import { InMemoryTraceSink, redactTraceValue, REDACTED } from "./tracing";

const tempDirs: string[] = [];

afterEach(async () => {
  const { rm } = await import("fs/promises");
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

async function tempPath(name: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tweedy-mastra-"));
  tempDirs.push(dir);
  return path.join(dir, name);
}

describe("Tweedy Mastra composition root", () => {
  it("constructs without provider credentials or external calls", () => {
    const runtime = createTweedyMastra({
      storagePath: ":memory:",
      traceSink: new InMemoryTraceSink(),
    });
    expect(runtime.mastra.getWorkflow("minimalWorkflow").id).toBe(
      "tweedy-runtime-smoke"
    );
  });

  it("starts a typed workflow and retrieves its durable snapshot", async () => {
    const databasePath = await tempPath("workflows.db");
    const sink = new InMemoryTraceSink();
    const { mastra, storage } = createTweedyMastra({
      storagePath: databasePath,
      traceSink: sink,
    });
    const workflow = mastra.getWorkflow("minimalWorkflow");
    const run = await workflow.createRun({ runId: "run-10" });
    const result = await run.start({
      inputData: {
        episodeId: "episode-10",
        runId: "run-10",
        flowVersion: "issue-10",
        modelTask: ModelTask.EpisodePlanning,
      },
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") {
      throw new Error(`Workflow did not complete: ${result.status}`);
    }
    expect(result.result).toMatchObject({ completed: true });
    const workflowsStore = await storage.getStore("workflows");
    const snapshot = await workflowsStore?.loadWorkflowSnapshot({
      workflowName: workflow.id,
      runId: "run-10",
    });
    expect(snapshot?.runId).toBe("run-10");
    expect(snapshot?.status).toBe("success");
    expect(sink.traces[0]).toMatchObject({
      episodeId: "episode-10",
      runId: "run-10",
      flowVersion: "issue-10",
      modelTask: ModelTask.EpisodePlanning,
      retryCount: 0,
      outcome: "completed",
    });
  });

  it("documents every ModelTask through the compatibility route", () => {
    const { routes } = createTweedyMastra({
      storagePath: ":memory:",
      traceSink: new InMemoryTraceSink(),
      provider: AiProviderName.OpenAI,
    });
    expect(Object.keys(routes).sort()).toEqual(Object.values(ModelTask).sort());
    expect(Object.values(routes).every((route) => route.path === "langchain-compatibility")).toBe(true);
  });
});

describe("trace redaction", () => {
  it("removes credentials and prompt/source text recursively", () => {
    const sentinelSecret = "sentinel-secret-value";
    const sentinelSource = "sentinel full source document";
    const safe = redactTraceValue({
      apiKey: sentinelSecret,
      nested: { authorization: `Bearer ${sentinelSecret}` },
      promptExcerpt: sentinelSource,
      modelTask: ModelTask.TurnReview,
      acceptedSpeechId: "speech-1",
    });
    const serialized = JSON.stringify(safe);
    expect(serialized).not.toContain(sentinelSecret);
    expect(serialized).not.toContain(sentinelSource);
    expect(serialized).toContain(REDACTED);
    expect(serialized).toContain("speech-1");
  });

  it("redacts before exporting JSONL", async () => {
    const tracePath = await tempPath("traces.jsonl");
    const { JsonlTraceSink } = await import("./tracing");
    const sink = new JsonlTraceSink(tracePath);
    await sink.export({
      episodeId: "episode",
      runId: "run",
      flowVersion: "v1",
      modelTask: ModelTask.SpeechGeneration,
      retryCount: 1,
      latencyMs: 5,
      attributes: { prompt: "sensitive prompt", apiKey: "secret" },
    });
    const output = await readFile(tracePath, "utf8");
    expect(output).not.toContain("sensitive prompt");
    expect(output).not.toContain("secret");
  });
});
