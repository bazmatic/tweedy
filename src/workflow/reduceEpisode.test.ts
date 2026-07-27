import { describe, expect, it } from "vitest";
import { createInitialEpisodeState, EpisodeDefinitionSchema } from "./episode-schemas";
import { InvalidTransitionError, reduceEpisode } from "./reduceEpisode";

const definition = EpisodeDefinitionSchema.parse({
  episodeId: "ep-1",
  workflowRunId: "run-1",
  discussionPointIds: ["dp-1"],
  conversationBeatIds: ["beat-1"],
  speakerIds: ["speaker-1", "speaker-2"],
});

const timestamp = "2026-07-27T00:00:00.000Z";

describe("reduceEpisode: preparing phase", () => {
  it("EPISODE_INITIALISED stays in preparing and records lastAppliedEvent", () => {
    const state = createInitialEpisodeState(definition);
    const next = reduceEpisode(state, { type: "EPISODE_INITIALISED", timestamp });
    expect(next.phase).toBe("preparing");
    expect(next.lastAppliedEvent).toBe("EPISODE_INITIALISED");
  });

  it("MATERIALS_PREPARED stays in preparing", () => {
    const state = createInitialEpisodeState(definition);
    const next = reduceEpisode(state, { type: "MATERIALS_PREPARED", timestamp });
    expect(next.phase).toBe("preparing");
  });

  it("ROLES_ASSIGNED sets speakerRoleAssignments and stays in preparing", () => {
    const state = createInitialEpisodeState(definition);
    const next = reduceEpisode(state, {
      type: "ROLES_ASSIGNED",
      timestamp,
      assignments: { "speaker-1": "host", "speaker-2": "guest" },
    });
    expect(next.phase).toBe("preparing");
    expect(next.speakerRoleAssignments).toEqual({ "speaker-1": "host", "speaker-2": "guest" });
  });

  it("PLAN_CREATED transitions preparing -> opening", () => {
    const state = createInitialEpisodeState(definition);
    const next = reduceEpisode(state, { type: "PLAN_CREATED", timestamp });
    expect(next.phase).toBe("opening");
  });

  it("WORKFLOW_WARNING_RECORDED appends a warning and stays in preparing", () => {
    const state = createInitialEpisodeState(definition);
    const next = reduceEpisode(state, {
      type: "WORKFLOW_WARNING_RECORDED",
      timestamp,
      message: "slow start",
    });
    expect(next.warnings).toEqual(["slow start"]);
    expect(next.phase).toBe("preparing");
  });

  it("does not mutate the input state", () => {
    const state = createInitialEpisodeState(definition);
    const snapshot = JSON.parse(JSON.stringify(state));
    reduceEpisode(state, { type: "PLAN_CREATED", timestamp });
    expect(state).toEqual(snapshot);
  });

  it("rejects a discussion-only event fired from preparing", () => {
    const state = createInitialEpisodeState(definition);
    expect(() =>
      reduceEpisode(state, {
        type: "TURN_DIRECTED",
        timestamp,
        speakerId: "speaker-1",
        direction: "go",
        kind: "speech",
      })
    ).toThrow(InvalidTransitionError);
  });
});

describe("reduceEpisode: opening phase", () => {
  function openingState() {
    const prepared = createInitialEpisodeState(definition);
    return reduceEpisode(prepared, { type: "PLAN_CREATED", timestamp });
  }

  it("OPENING_ADVANCED increments openingCursor and stays in opening when not final", () => {
    const state = openingState();
    const next = reduceEpisode(state, {
      type: "OPENING_ADVANCED",
      timestamp,
      isFinalOpeningTurn: false,
    });
    expect(next.openingCursor).toBe(1);
    expect(next.phase).toBe("opening");
  });

  it("OPENING_ADVANCED transitions opening -> discussion when final", () => {
    const state = openingState();
    const next = reduceEpisode(state, {
      type: "OPENING_ADVANCED",
      timestamp,
      isFinalOpeningTurn: true,
    });
    expect(next.openingCursor).toBe(1);
    expect(next.phase).toBe("discussion");
  });

  it("WORKFLOW_WARNING_RECORDED stays in opening", () => {
    const state = openingState();
    const next = reduceEpisode(state, {
      type: "WORKFLOW_WARNING_RECORDED",
      timestamp,
      message: "opening ran long",
    });
    expect(next.phase).toBe("opening");
    expect(next.warnings).toEqual(["opening ran long"]);
  });

  it("rejects PLAN_CREATED fired again from opening", () => {
    const state = openingState();
    expect(() => reduceEpisode(state, { type: "PLAN_CREATED", timestamp })).toThrow(
      InvalidTransitionError
    );
  });
});

describe("reduceEpisode: discussion phase turn pipeline", () => {
  function discussionState() {
    const prepared = createInitialEpisodeState(definition);
    const opened = reduceEpisode(prepared, { type: "PLAN_CREATED", timestamp });
    return reduceEpisode(opened, { type: "OPENING_ADVANCED", timestamp, isFinalOpeningTurn: true });
  }

  it("TURN_DIRECTED opens a pendingTurn", () => {
    const state = discussionState();
    const next = reduceEpisode(state, {
      type: "TURN_DIRECTED",
      timestamp,
      speakerId: "speaker-1",
      direction: "open with a hook",
      kind: "speech",
    });
    expect(next.pendingTurn).toEqual({
      kind: "speech",
      speakerId: "speaker-1",
      direction: "open with a hook",
      candidateMessage: null,
      candidateStopReason: null,
      reviewNotes: null,
      reviewApproved: null,
    });
  });

  it("rejects TURN_DIRECTED while a turn is already pending", () => {
    const state = discussionState();
    const directed = reduceEpisode(state, {
      type: "TURN_DIRECTED",
      timestamp,
      speakerId: "speaker-1",
      direction: "go",
      kind: "speech",
    });
    expect(() =>
      reduceEpisode(directed, {
        type: "TURN_DIRECTED",
        timestamp,
        speakerId: "speaker-2",
        direction: "go again",
        kind: "speech",
      })
    ).toThrow(InvalidTransitionError);
  });

  it("full accept path: directed -> generated -> reviewed -> accepted", () => {
    let state = discussionState();
    state = reduceEpisode(state, {
      type: "TURN_DIRECTED",
      timestamp,
      speakerId: "speaker-1",
      direction: "open with a hook",
      kind: "speech",
    });
    state = reduceEpisode(state, { type: "TURN_GENERATED", timestamp, message: "hello", stopReason: "stop" });
    expect(state.pendingTurn?.candidateMessage).toBe("hello");

    state = reduceEpisode(state, { type: "TURN_REVIEWED", timestamp, approved: true, notes: "good" });
    expect(state.pendingTurn?.reviewApproved).toBe(true);

    state = reduceEpisode(state, {
      type: "TURN_ACCEPTED",
      timestamp,
      speechId: "speech-1",
      durationSeconds: 10,
      coveredDiscussionPointIds: ["dp-1"],
      coveredConversationBeatIds: ["beat-1"],
    });
    expect(state.pendingTurn).toBeNull();
    expect(state.acceptedSpeechIds).toEqual(["speech-1"]);
    expect(state.turnsUsed).toBe(1);
    expect(state.elapsedDurationEstimateSeconds).toBe(10);
    expect(state.discussionPoints).toEqual([{ id: "dp-1", covered: true }]);
    expect(state.conversationBeats).toEqual([{ id: "beat-1", covered: true }]);
  });

  it("reject path clears pendingTurn and records a warning without touching acceptedSpeechIds", () => {
    let state = discussionState();
    state = reduceEpisode(state, {
      type: "TURN_DIRECTED",
      timestamp,
      speakerId: "speaker-1",
      direction: "go",
      kind: "speech",
    });
    state = reduceEpisode(state, { type: "TURN_GENERATED", timestamp, message: "hello", stopReason: "stop" });
    state = reduceEpisode(state, { type: "TURN_REVIEWED", timestamp, approved: false, notes: "repetitive" });
    state = reduceEpisode(state, { type: "TURN_REJECTED", timestamp, reason: "too repetitive" });
    expect(state.pendingTurn).toBeNull();
    expect(state.acceptedSpeechIds).toEqual([]);
    expect(state.warnings).toEqual(["too repetitive"]);
  });

  it("rejects TURN_GENERATED with no pendingTurn", () => {
    const state = discussionState();
    expect(() =>
      reduceEpisode(state, { type: "TURN_GENERATED", timestamp, message: "hello", stopReason: "stop" })
    ).toThrow(InvalidTransitionError);
  });

  it("rejects TURN_REVIEWED before a candidate is generated", () => {
    let state = discussionState();
    state = reduceEpisode(state, {
      type: "TURN_DIRECTED",
      timestamp,
      speakerId: "speaker-1",
      direction: "go",
      kind: "speech",
    });
    expect(() =>
      reduceEpisode(state, { type: "TURN_REVIEWED", timestamp, approved: true, notes: "n/a" })
    ).toThrow(InvalidTransitionError);
  });

  it("rejects TURN_ACCEPTED when the review was not approved", () => {
    let state = discussionState();
    state = reduceEpisode(state, {
      type: "TURN_DIRECTED",
      timestamp,
      speakerId: "speaker-1",
      direction: "go",
      kind: "speech",
    });
    state = reduceEpisode(state, { type: "TURN_GENERATED", timestamp, message: "hello", stopReason: "stop" });
    state = reduceEpisode(state, { type: "TURN_REVIEWED", timestamp, approved: false, notes: "no" });
    expect(() =>
      reduceEpisode(state, {
        type: "TURN_ACCEPTED",
        timestamp,
        speechId: "speech-1",
        durationSeconds: 1,
        coveredDiscussionPointIds: [],
        coveredConversationBeatIds: [],
      })
    ).toThrow(InvalidTransitionError);
  });

  it("does not increment turnsUsed for an accepted interjection", () => {
    let state = discussionState();
    state = reduceEpisode(state, {
      type: "TURN_DIRECTED",
      timestamp,
      speakerId: "speaker-2",
      direction: "push back",
      kind: "interjection",
    });
    state = reduceEpisode(state, { type: "TURN_GENERATED", timestamp, message: "wait", stopReason: "stop" });
    state = reduceEpisode(state, { type: "TURN_REVIEWED", timestamp, approved: true, notes: "ok" });
    state = reduceEpisode(state, {
      type: "TURN_ACCEPTED",
      timestamp,
      speechId: "speech-interjection-1",
      durationSeconds: 3,
      coveredDiscussionPointIds: [],
      coveredConversationBeatIds: [],
    });
    expect(state.turnsUsed).toBe(0);
    expect(state.acceptedSpeechIds).toEqual(["speech-interjection-1"]);
  });
});
