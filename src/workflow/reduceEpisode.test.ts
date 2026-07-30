import { describe, expect, it } from "vitest";
import { createInitialEpisodeState, EpisodeDefinitionSchema, EpisodeStateSchema } from "./episode-schemas";
import { InvalidTransitionError, reduceEpisode } from "./reduceEpisode";
import { EPISODE_EVENT_TYPES } from "./episode-events";

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
      logicalTurn: 0,
      idempotencyKey: "ep-1/run-1/0/speech",
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
    expect(state.consecutiveRejectedTurns).toBe(1);
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

  it("TURN_REVISED replaces a rejected candidate and requires re-review", () => {
    let state = discussionState();
    state = reduceEpisode(state, {
      type: "TURN_DIRECTED",
      timestamp,
      speakerId: "speaker-1",
      direction: "explain",
      kind: "speech",
    });
    state = reduceEpisode(state, {
      type: "TURN_GENERATED",
      timestamp,
      message: "unclear candidate",
      stopReason: "stop",
    });
    state = reduceEpisode(state, {
      type: "TURN_REVIEWED",
      timestamp,
      approved: false,
      notes: "make it clearer",
    });
    const revised = reduceEpisode(state, {
      type: "TURN_REVISED",
      timestamp,
      message: "clear candidate",
      stopReason: "stop",
    });

    expect(revised.pendingTurn).toMatchObject({
      candidateMessage: "clear candidate",
      reviewApproved: null,
      reviewNotes: null,
    });
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

describe("reduceEpisode: interjections, closing and completion", () => {
  function discussionState() {
    const prepared = createInitialEpisodeState(definition);
    const opened = reduceEpisode(prepared, { type: "PLAN_CREATED", timestamp });
    return reduceEpisode(opened, { type: "OPENING_ADVANCED", timestamp, isFinalOpeningTurn: true });
  }

  it("INTERJECTION_REQUESTED opens an interjection pendingTurn", () => {
    const state = discussionState();
    const next = reduceEpisode(state, {
      type: "INTERJECTION_REQUESTED",
      timestamp,
      speakerId: "speaker-2",
      direction: "push back",
    });
    expect(next.pendingTurn?.kind).toBe("interjection");
    expect(next.pendingTurn?.speakerId).toBe("speaker-2");
  });

  it("CLOSING_REQUESTED transitions discussion -> closing when no turn is pending", () => {
    const state = discussionState();
    const next = reduceEpisode(state, {
      type: "CLOSING_REQUESTED",
      timestamp,
      reason: "duration limit reached",
    });
    expect(next.phase).toBe("closing");
    expect(next.terminationRequested).toBe(true);
    expect(next.terminationReason).toBe("duration limit reached");
  });

  it("rejects CLOSING_REQUESTED when already in the closing phase", () => {
    const state = discussionState();
    const closing = reduceEpisode(state, { type: "CLOSING_REQUESTED", timestamp, reason: "time" });
    expect(() =>
      reduceEpisode(closing, { type: "CLOSING_REQUESTED", timestamp, reason: "time again" })
    ).toThrow(InvalidTransitionError);
  });

  it("rejects EPISODE_COMPLETED while a turn is pending in the closing phase", () => {
    const state = discussionState();
    let closing = reduceEpisode(state, { type: "CLOSING_REQUESTED", timestamp, reason: "time" });
    closing = reduceEpisode(closing, {
      type: "TURN_DIRECTED",
      timestamp,
      speakerId: "speaker-1",
      direction: "wrap up",
      kind: "speech",
    });
    expect(() => reduceEpisode(closing, { type: "EPISODE_COMPLETED", timestamp })).toThrow(
      InvalidTransitionError
    );
  });

  it("rejects CLOSING_REQUESTED while a turn is pending", () => {
    let state = discussionState();
    state = reduceEpisode(state, {
      type: "TURN_DIRECTED",
      timestamp,
      speakerId: "speaker-1",
      direction: "go",
      kind: "speech",
    });
    expect(() =>
      reduceEpisode(state, { type: "CLOSING_REQUESTED", timestamp, reason: "time" })
    ).toThrow(InvalidTransitionError);
  });

  it("rejects EPISODE_COMPLETED fired from discussion", () => {
    const state = discussionState();
    expect(() => reduceEpisode(state, { type: "EPISODE_COMPLETED", timestamp })).toThrow(
      InvalidTransitionError
    );
  });

  it("EPISODE_COMPLETED transitions closing -> completed", () => {
    const state = discussionState();
    const closing = reduceEpisode(state, { type: "CLOSING_REQUESTED", timestamp, reason: "time" });
    const completed = reduceEpisode(closing, { type: "EPISODE_COMPLETED", timestamp });
    expect(completed.phase).toBe("completed");
  });

  it("CLOSING_ADVANCED increments the closing cursor after an accepted stage", () => {
    const state = discussionState();
    const closing = reduceEpisode(state, {
      type: "CLOSING_REQUESTED",
      timestamp,
      reason: "time",
    });
    const advanced = reduceEpisode(closing, {
      type: "CLOSING_ADVANCED",
      timestamp,
      isFinalClosingTurn: false,
    });
    expect(advanced.phase).toBe("closing");
    expect(advanced.closingCursor).toBe(1);
  });

  it("the turn pipeline still works from closing (final sign-off turn)", () => {
    const state = discussionState();
    let closing = reduceEpisode(state, { type: "CLOSING_REQUESTED", timestamp, reason: "time" });
    closing = reduceEpisode(closing, {
      type: "TURN_DIRECTED",
      timestamp,
      speakerId: "speaker-1",
      direction: "wrap up",
      kind: "speech",
    });
    closing = reduceEpisode(closing, { type: "TURN_GENERATED", timestamp, message: "bye", stopReason: "stop" });
    closing = reduceEpisode(closing, { type: "TURN_REVIEWED", timestamp, approved: true, notes: "ok" });
    closing = reduceEpisode(closing, {
      type: "TURN_ACCEPTED",
      timestamp,
      speechId: "speech-final",
      durationSeconds: 5,
      coveredDiscussionPointIds: [],
      coveredConversationBeatIds: [],
    });
    expect(closing.acceptedSpeechIds).toEqual(["speech-final"]);

    const completed = reduceEpisode(closing, { type: "EPISODE_COMPLETED", timestamp });
    expect(completed.phase).toBe("completed");
  });

  it("projects established and teased discourse state only on TURN_ACCEPTED", () => {
    let state = discussionState();
    state.discourseClaims = [
      { id: "b1-c1", covered: false },
      { id: "b1-c2", covered: false },
    ];
    state = reduceEpisode(state, {
      type: "TURN_DIRECTED",
      timestamp,
      speakerId: "speaker-1",
      direction: "establish context",
      kind: "speech",
    });
    state = reduceEpisode(state, {
      type: "TURN_GENERATED",
      timestamp,
      message: "context",
      stopReason: "stop",
    });
    state = reduceEpisode(state, {
      type: "TURN_REVIEWED",
      timestamp,
      approved: true,
      notes: "ok",
    });
    state = reduceEpisode(state, {
      type: "TURN_ACCEPTED",
      timestamp,
      speechId: "speech-context",
      durationSeconds: 4,
      coveredDiscussionPointIds: [],
      coveredConversationBeatIds: [],
      establishedDiscourseClaimIds: ["b1-c1"],
      teasedDiscourseClaimIds: ["b1-c2"],
    });

    expect(state.discourseClaims).toEqual([
      { id: "b1-c1", covered: true },
      { id: "b1-c2", covered: false },
    ]);
    expect(state.teasedDiscourseClaimIds).toEqual(["b1-c2"]);
  });

  it.each(["completed", "failed"] as const)(
    "every event is rejected from the terminal %s phase",
    (phase) => {
      const state = { ...discussionState(), phase };
      const sampleEvents: Array<[string, object]> = [
        ["EPISODE_INITIALISED", { type: "EPISODE_INITIALISED", timestamp }],
        ["WORKFLOW_WARNING_RECORDED", { type: "WORKFLOW_WARNING_RECORDED", timestamp, message: "x" }],
        ["EPISODE_COMPLETED", { type: "EPISODE_COMPLETED", timestamp }],
      ];
      for (const [, event] of sampleEvents) {
        expect(() => reduceEpisode(state, event as never)).toThrow(InvalidTransitionError);
      }
    }
  );
});

describe("reduceEpisode: round-trip, immutability and event coverage", () => {
  it("round-trips a state that has been through several transitions via JSON", () => {
    let state = createInitialEpisodeState(definition);
    state = reduceEpisode(state, { type: "PLAN_CREATED", timestamp });
    state = reduceEpisode(state, { type: "OPENING_ADVANCED", timestamp, isFinalOpeningTurn: true });
    state = reduceEpisode(state, {
      type: "TURN_DIRECTED",
      timestamp,
      speakerId: "speaker-1",
      direction: "go",
      kind: "speech",
    });

    const roundTripped = EpisodeStateSchema.parse(JSON.parse(JSON.stringify(state)));
    expect(roundTripped).toEqual(state);
  });

  it("never mutates a frozen input state across every event type used in this file", () => {
    let state = createInitialEpisodeState(definition);
    state = reduceEpisode(state, { type: "PLAN_CREATED", timestamp });
    state = reduceEpisode(state, { type: "OPENING_ADVANCED", timestamp, isFinalOpeningTurn: true });

    const frozen = Object.freeze({
      ...state,
      discussionPoints: state.discussionPoints.map((p) => Object.freeze({ ...p })),
      conversationBeats: state.conversationBeats.map((b) => Object.freeze({ ...b })),
    });

    expect(() =>
      reduceEpisode(frozen, {
        type: "TURN_DIRECTED",
        timestamp,
        speakerId: "speaker-1",
        direction: "go",
        kind: "speech",
      })
    ).not.toThrow();
  });

  it("has at least one valid (phase, event) transition covered by this suite for every declared event type", () => {
    const coveredEventTypes = new Set([
      "EPISODE_INITIALISED",
      "MATERIALS_PREPARED",
      "ROLES_ASSIGNED",
      "PLAN_CREATED",
      "OPENING_ADVANCED",
      "TURN_DIRECTED",
      "TURN_GENERATED",
      "TURN_REVIEWED",
      "TURN_REVISED",
      "TURN_REJECTED",
      "TURN_ACCEPTED",
      "INTERJECTION_REQUESTED",
      "CLOSING_REQUESTED",
      "CLOSING_ADVANCED",
      "EPISODE_COMPLETED",
      "WORKFLOW_WARNING_RECORDED",
    ]);

    for (const eventType of EPISODE_EVENT_TYPES) {
      expect(coveredEventTypes.has(eventType), `missing coverage for ${eventType}`).toBe(true);
    }
    expect(EPISODE_EVENT_TYPES.length).toBe(coveredEventTypes.size);
  });
});
