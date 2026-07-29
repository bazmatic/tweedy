import { mkdtemp, rm } from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTweedyMastra,
  EpisodeWorkflowDependencies,
  InMemoryTraceSink,
  TurnSelection,
} from ".";
import { EpisodeState } from "../workflow/episode-schemas";
import { ModelTask } from "../providers/ModelRoutingPolicy";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) => rm(directory, { recursive: true }))
  );
});

async function databasePath(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "tweedy-episode-workflow-")
  );
  tempDirs.push(directory);
  return path.join(directory, "workflow.db");
}

function selection(
  state: EpisodeState,
  overrides: Partial<TurnSelection> = {}
): TurnSelection {
  return {
    kind: "speech",
    logicalTurn: state.turnsUsed,
    speakerId:
      state.turnsUsed % 2 === 0 ? "speaker-1" : "speaker-2",
    direction: "continue the episode",
    isOpeningTurn: state.phase === "opening",
    isFinalOpeningTurn: state.phase === "opening",
    isFinalTurn: false,
    wasRepaired: false,
    modelTask: ModelTask.DirectionSelection,
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<EpisodeWorkflowDependencies> = {}
): EpisodeWorkflowDependencies {
  let speechNumber = 0;
  return {
    prepareMaterials: vi.fn().mockResolvedValue(undefined),
    assignSpeakerRoles: vi
      .fn()
      .mockResolvedValue({ "speaker-1": "expert", "speaker-2": "audience_guide" }),
    createPlan: vi
      .fn()
      .mockResolvedValue({
        discussionPointIds: ["point-1"],
        conversationBeatIds: ["beat-1"],
      }),
    inspectEpisode: vi.fn(async (state) => ({
      phase: state.phase,
      turnsUsed: state.turnsUsed,
    })),
    proposeTurn: vi.fn(async (state) =>
      selection(state, {
        isFinalTurn: state.phase === "discussion" && state.turnsUsed >= 2,
      })
    ),
    repairTurn: vi.fn(async (_state, proposal) => proposal),
    forceClosingTurn: vi.fn(async (state) =>
      selection(state, {
        direction: "deliver the final sign-off",
        isOpeningTurn: false,
        isFinalOpeningTurn: false,
        isFinalTurn: true,
      })
    ),
    generateCandidate: vi.fn(async () => ({
      message: `speech-${++speechNumber}`,
      stopReason: "stop" as const,
      data: {},
    })),
    reviewCandidate: vi
      .fn()
      .mockResolvedValue({ approved: true, notes: "approved" }),
    validateIntegrity: vi.fn().mockResolvedValue(null),
    validateRepetition: vi.fn().mockResolvedValue(null),
    persistCandidate: vi.fn(async (_state, turn) => ({
      speechId: `${turn.kind}-${turn.logicalTurn}-${speechNumber}`,
      durationSeconds: 5,
      coveredDiscussionPointIds:
        turn.isOpeningTurn ? [] : ["point-1"],
      coveredConversationBeatIds:
        turn.isOpeningTurn ? ["beat-1"] : [],
      introducedKnowledgeIds: [`knowledge-${speechNumber}`],
      introducedTerms: [`term-${speechNumber}`],
    })),
    isNaturallyComplete: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

async function runEpisode(
  workflowDependencies: EpisodeWorkflowDependencies,
  options: { maxTurns?: number; maxDurationSeconds?: number } = {}
) {
  const traceSink = new InMemoryTraceSink();
  const runtime = createTweedyMastra({
    storagePath: await databasePath(),
    traceSink,
    episodeWorkflowDependencies: workflowDependencies,
  });
  const workflow = runtime.mastra.getWorkflow("episodeWorkflow");
  const run = await workflow.createRunAsync({ runId: "run-12" });
  const result = await run.start({
    inputData: {
      definition: {
        episodeId: "episode-12",
        workflowRunId: "run-12",
        discussionPointIds: ["point-1"],
        conversationBeatIds: ["beat-1"],
        speakerIds: ["speaker-1", "speaker-2"],
      },
      maxTurns: options.maxTurns ?? 4,
      maxDurationSeconds: options.maxDurationSeconds ?? 120,
    },
  });
  if (result.status !== "success") {
    throw new Error(`Workflow ended with ${result.status}`);
  }
  return { result: result.result, runtime, traceSink, workflow };
}

describe("nested Mastra episode workflow", () => {
  it("runs opening, discussion and final sign-off to completion", async () => {
    const deps = dependencies();
    const { result, runtime, workflow, traceSink } = await runEpisode(deps);

    expect(result.state.phase).toBe("completed");
    expect(result.state.openingCursor).toBe(1);
    expect(result.state.acceptedSpeechIds).toHaveLength(3);
    expect(result.state.discussionPoints[0].covered).toBe(true);
    expect(result.state.conversationBeats[0].covered).toBe(true);
    expect(result.state.pendingTurn).toBeNull();
    expect(traceSink.traces.some((trace) => trace.outcome === "completed")).toBe(
      true
    );

    const snapshot = await runtime.storage.loadWorkflowSnapshot({
      workflowName: workflow.id,
      runId: "run-12",
    });
    expect(snapshot?.status).toBe("success");
  });

  it("rejects a candidate without mutating accepted truth, then iterates fresh", async () => {
    let validationCalls = 0;
    const deps = dependencies({
      validateRepetition: vi.fn(async () =>
        validationCalls++ === 0 ? "repeated candidate" : null
      ),
    });
    const { result } = await runEpisode(deps);

    expect(result.state.phase).toBe("completed");
    expect(result.state.warnings).toContain("repeated candidate");
    expect(result.state.acceptedSpeechIds).not.toContain("speech-0-1");
    expect(result.state.elapsedDurationEstimateSeconds).toBe(
      result.state.acceptedSpeechIds.length * 5
    );
  });

  it("revises and re-reviews an editorially rejected candidate", async () => {
    let firstReview = true;
    const reviewCandidate = vi.fn(async () => {
      if (firstReview) {
        firstReview = false;
        return { approved: false, notes: "make it clearer" };
      }
      return { approved: true, notes: "revision approved" };
    });
    const reviseCandidate = vi.fn(async (_state, _turn, candidate) => ({
      ...candidate,
      message: `${candidate.message} revised`,
    }));
    const { result, traceSink } = await runEpisode(
      dependencies({ reviewCandidate, reviseCandidate })
    );

    expect(result.state.phase).toBe("completed");
    expect(reviseCandidate).toHaveBeenCalledTimes(1);
    expect(reviewCandidate.mock.calls.length).toBeGreaterThan(
      result.state.acceptedSpeechIds.length
    );
    expect(traceSink.traces).toContainEqual(
      expect.objectContaining({
        modelTask: ModelTask.TurnReview,
        outcome: "repaired",
      })
    );
  });

  it("accepts an interjection with an independent idempotency identity", async () => {
    let offered = false;
    const persistCandidate = vi.fn(
      async (_state, turn, _candidate, idempotencyKey) => ({
        speechId: `${turn.kind}-${turn.logicalTurn}`,
        durationSeconds: 2,
        introducedTerms: [idempotencyKey],
      })
    );
    const deps = dependencies({
      persistCandidate,
      selectInterjection: vi.fn(async (state) => {
        if (offered) return null;
        offered = true;
        return selection(state, {
          kind: "interjection",
          speakerId: "speaker-2",
          direction: "react briefly",
          isOpeningTurn: false,
          isFinalOpeningTurn: false,
          isFinalTurn: false,
        });
      }),
    });
    const { result } = await runEpisode(deps);

    expect(result.state.acceptedSpeechIds).toContain("interjection-2");
    expect(persistCandidate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: "interjection" }),
      expect.anything(),
      "episode-12/run-12/2/interjection"
    );
  });

  it("forces a bounded close when direction selection fails", async () => {
    const forceClosingTurn = vi.fn(async (state: EpisodeState) =>
      selection(state, {
        direction: "forced close",
        isOpeningTurn: false,
        isFinalOpeningTurn: false,
        isFinalTurn: true,
      })
    );
    const deps = dependencies({
      proposeTurn: vi.fn().mockRejectedValue(new Error("model unavailable")),
      forceClosingTurn,
    });
    const { result } = await runEpisode(deps);

    expect(result.state.phase).toBe("completed");
    expect(result.state.terminationReason).toBe("final turn selected");
    expect(forceClosingTurn).toHaveBeenCalled();
  });

  it.each([
    ["turn limit", { maxTurns: 1, maxDurationSeconds: 120 }],
    ["duration limit", { maxTurns: 8, maxDurationSeconds: 1 }],
  ])("forces a final sign-off at the %s", async (reason, limits) => {
    const forceClosingTurn = vi.fn(async (state: EpisodeState) =>
      selection(state, {
        direction: "bounded final sign-off",
        isFinalTurn: true,
      })
    );
    const { result } = await runEpisode(
      dependencies({ forceClosingTurn }),
      limits
    );

    expect(result.state.phase).toBe("completed");
    expect(forceClosingTurn).toHaveBeenCalledWith(expect.anything(), reason);
  });

  it("uses the natural conclusion judgement but remains explicitly final", async () => {
    const forceClosingTurn = vi.fn(async (state: EpisodeState) =>
      selection(state, {
        direction: "natural final sign-off",
        isFinalTurn: true,
      })
    );
    const { result } = await runEpisode(
      dependencies({
        forceClosingTurn,
        isNaturallyComplete: vi.fn().mockResolvedValue(true),
      })
    );

    expect(result.state.phase).toBe("completed");
    expect(forceClosingTurn).toHaveBeenCalledWith(
      expect.anything(),
      "natural conclusion"
    );
  });

  it("records material preparation failure and continues without RAG", async () => {
    const { result } = await runEpisode(
      dependencies({
        prepareMaterials: vi
          .fn()
          .mockRejectedValue(new Error("embedding store unavailable")),
      })
    );

    expect(result.state.phase).toBe("completed");
    expect(result.state.warnings).toContain(
      "Material preparation failed: embedding store unavailable"
    );
  });

  it("uses stable persistence keys when replayed after a post-write failure", async () => {
    const durable = new Map<string, string>();
    let failAfterFirstWrite = true;
    const persistCandidate = vi.fn(
      async (_state, turn, _candidate, idempotencyKey) => {
        const speechId =
          durable.get(idempotencyKey) ??
          `${turn.kind}-${turn.logicalTurn}-${durable.size}`;
        durable.set(idempotencyKey, speechId);
        if (failAfterFirstWrite) {
          failAfterFirstWrite = false;
          throw new Error("simulated post-write crash");
        }
        return { speechId, durationSeconds: 3 };
      }
    );
    const deps = dependencies({ persistCandidate });
    const { result } = await runEpisode(deps);

    expect(result.state.phase).toBe("completed");
    expect(new Set(result.state.acceptedSpeechIds).size).toBe(
      result.state.acceptedSpeechIds.length
    );
    expect(new Set(durable.values()).size).toBe(durable.size);
    expect(persistCandidate.mock.calls[0][3]).toBe(
      persistCandidate.mock.calls[1][3]
    );
  });
});
