import { describe, expect, it, vi } from "vitest";
import { createInitialEpisodeState } from "./episode-schemas";
import { reduceEpisode } from "./reduceEpisode";
import { produceTurn, turnIdempotencyKey } from "./TransactionalTurnProducer";

const timestamp = "2026-07-27T00:00:00.000Z";

function discussionState() {
  let state = createInitialEpisodeState({
    episodeId: "episode-1",
    workflowRunId: "run-1",
    discussionPointIds: ["point-1"],
    conversationBeatIds: ["beat-1"],
    speakerIds: ["speaker-1", "speaker-2"],
  });
  state = reduceEpisode(state, { type: "PLAN_CREATED", timestamp });
  return reduceEpisode(state, {
    type: "OPENING_ADVANCED",
    timestamp,
    isFinalOpeningTurn: true,
  });
}

function operations(overrides: Record<string, unknown> = {}) {
  return {
    generate: vi.fn().mockResolvedValue({ message: "A useful turn", stopReason: "stop" }),
    review: vi.fn().mockResolvedValue({ approved: true, notes: "good" }),
    validateIntegrity: vi.fn().mockResolvedValue(null),
    validateRepetition: vi.fn().mockResolvedValue(null),
    persist: vi.fn().mockResolvedValue({
      speechId: "speech-1",
      durationSeconds: 4,
      coveredDiscussionPointIds: ["point-1"],
      coveredConversationBeatIds: ["beat-1"],
      introducedKnowledgeIds: ["card-1"],
      introducedTerms: ["entropy"],
    }),
    ...overrides,
  } as any;
}

describe("produceTurn", () => {
  it("leaves accepted state unchanged after generation failure", async () => {
    const state = discussionState();
    const result = await produceTurn({
      state,
      kind: "speech",
      logicalTurn: 0,
      speakerId: "speaker-1",
      direction: "explain",
      operations: operations({ generate: vi.fn().mockRejectedValue(new Error("offline")) }),
    });
    expect(result.state).toBe(state);
    expect(result.state.acceptedSpeechIds).toEqual([]);
  });

  it("fails review open and accepts only after persistence", async () => {
    const persist = vi.fn().mockResolvedValue({ speechId: "speech-1", durationSeconds: 4 });
    const result = await produceTurn({
      state: discussionState(),
      kind: "speech",
      logicalTurn: 0,
      speakerId: "speaker-1",
      direction: "explain",
      operations: operations({
        review: vi.fn().mockRejectedValue(new Error("reviewer offline")),
        persist,
      }),
    });
    expect(result.accepted).toBe(true);
    expect(result.events.map((event) => event.type)).toEqual([
      "TURN_DIRECTED",
      "TURN_GENERATED",
      "TURN_REVIEWED",
      "TURN_ACCEPTED",
    ]);
    expect(result.state.knowledgeLedger).toEqual([]);
    expect(persist).toHaveBeenCalledWith(
      expect.anything(),
      "episode-1/run-1/0/speech"
    );
  });

  it("rejects repetition without changing coverage, duration or accepted ids", async () => {
    const persist = vi.fn();
    const result = await produceTurn({
      state: discussionState(),
      kind: "speech",
      logicalTurn: 0,
      speakerId: "speaker-1",
      direction: "explain",
      operations: operations({
        validateRepetition: vi.fn().mockResolvedValue("repeated"),
        persist,
      }),
    });
    expect(result.accepted).toBe(false);
    expect(result.state.acceptedSpeechIds).toEqual([]);
    expect(result.state.elapsedDurationEstimateSeconds).toBe(0);
    expect(result.state.discussionPoints[0].covered).toBe(false);
    expect(persist).not.toHaveBeenCalled();
  });

  it("replays a crash after persistence using the same normal-turn key", async () => {
    const durable = new Map<string, string>();
    const persist = vi.fn(async (_candidate, key: string) => {
      const speechId = durable.get(key) ?? "speech-1";
      durable.set(key, speechId);
      return { speechId, durationSeconds: 4 };
    });
    const request = {
      state: discussionState(),
      kind: "speech" as const,
      logicalTurn: 0,
      speakerId: "speaker-1",
      direction: "explain",
      operations: operations({ persist }),
    };
    await expect(
      produceTurn({ ...request, afterPersist: () => { throw new Error("crash"); } })
    ).rejects.toThrow("crash");
    const replay = await produceTurn(request);
    expect(replay.state.acceptedSpeechIds).toEqual(["speech-1"]);
    expect(new Set(durable.values())).toEqual(new Set(["speech-1"]));
  });

  it("gives an interjection its own traceable logical identity", async () => {
    const result = await produceTurn({
      state: discussionState(),
      kind: "interjection",
      logicalTurn: 3,
      speakerId: "speaker-2",
      direction: "react briefly",
      operations: operations(),
    });
    expect(result.events[0]).toEqual(
      expect.objectContaining({
        type: "INTERJECTION_REQUESTED",
        idempotencyKey: "episode-1/run-1/3/interjection",
      })
    );
    expect(result.state.turnsUsed).toBe(0);
  });
});

describe("turnIdempotencyKey", () => {
  it("escapes identity components without losing stability", () => {
    expect(turnIdempotencyKey("episode/a", "run 1", 2, "speech")).toBe(
      "episode%2Fa/run%201/2/speech"
    );
  });
});
