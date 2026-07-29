import { mkdtemp, rm } from "fs/promises";
import * as os from "os";
import * as path from "path";
import { Mastra } from "@mastra/core/mastra";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { LibSQLStore } from "@mastra/libsql";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true }))
  );
});

class IdempotentSpeechFake {
  readonly records = new Map<string, string>();
  writes = 0;

  createOrReturn(idempotencyKey: string): string {
    const existing = this.records.get(idempotencyKey);
    if (existing) return existing;
    const speechId = `speech-${this.records.size + 1}`;
    this.records.set(idempotencyKey, speechId);
    this.writes += 1;
    return speechId;
  }
}

const ResumeInputSchema = z.object({
  episodeId: z.string(),
  runId: z.string(),
  idempotencyKey: z.string(),
});
const ResumeDataSchema = z.object({ continue: z.literal(true) });
const SuspendDataSchema = z.object({
  speechId: z.string(),
  idempotencyKey: z.string(),
});
const ResumeOutputSchema = ResumeInputSchema.extend({
  speechId: z.string(),
  accepted: z.literal(true),
});

function createResumeRuntime(storagePath: string, speeches: IdempotentSpeechFake) {
  const persistThenSuspend = createStep({
    id: "persist-then-suspend",
    inputSchema: ResumeInputSchema,
    outputSchema: ResumeOutputSchema,
    resumeSchema: ResumeDataSchema,
    suspendSchema: SuspendDataSchema,
    execute: async ({ inputData, resumeData, suspend }) => {
      const speechId = speeches.createOrReturn(inputData.idempotencyKey);
      if (!resumeData) {
        return suspend({
          speechId,
          idempotencyKey: inputData.idempotencyKey,
        });
      }
      return { ...inputData, speechId, accepted: true as const };
    },
  });
  const workflow = createWorkflow({
    id: "acceptance-resume-proof",
    inputSchema: ResumeInputSchema,
    outputSchema: ResumeOutputSchema,
    options: { shouldPersistSnapshot: () => true },
  })
    .then(persistThenSuspend)
    .commit();
  const storage = new LibSQLStore({ url: `file:${storagePath}` });
  return {
    mastra: new Mastra({ storage, workflows: { workflow } }),
    storage,
    persistThenSuspend,
  };
}

describe("Mastra durable suspension and resume", () => {
  it("resumes from a serialised snapshot without duplicating persisted speech", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "tweedy-mastra-resume-")
    );
    tempDirectories.push(directory);
    const storagePath = path.join(directory, "workflow.db");
    const speeches = new IdempotentSpeechFake();
    const input = {
      episodeId: "episode-13",
      runId: "run-13",
      idempotencyKey: "episode-13/run-13/0/speech",
    };

    const firstRuntime = createResumeRuntime(storagePath, speeches);
    const firstRun = await firstRuntime.mastra
      .getWorkflow("workflow")
      .createRunAsync({ runId: input.runId });
    const suspended = await firstRun.start({ inputData: input });

    expect(suspended.status).toBe("suspended");
    expect(speeches.writes).toBe(1);
    const snapshot = await firstRuntime.storage.loadWorkflowSnapshot({
      workflowName: "acceptance-resume-proof",
      runId: input.runId,
    });
    expect(snapshot?.status).toBe("suspended");
    expect(JSON.stringify(snapshot)).toContain(input.idempotencyKey);

    // Reconstruct the runtime to prove the resume source is durable storage,
    // not the original in-memory Run object.
    const resumedRuntime = createResumeRuntime(storagePath, speeches);
    const resumedRun = await resumedRuntime.mastra
      .getWorkflow("workflow")
      .createRunAsync({ runId: input.runId });
    const resumed = await resumedRun.resume({
      step: resumedRuntime.persistThenSuspend,
      resumeData: { continue: true },
    });

    expect(resumed.status).toBe("success");
    if (resumed.status !== "success") {
      throw new Error(`Resume ended with ${resumed.status}`);
    }
    expect(resumed.result).toEqual({ ...input, speechId: "speech-1", accepted: true });
    expect(speeches.writes).toBe(1);
    expect(speeches.records).toHaveLength(1);
  });
});
