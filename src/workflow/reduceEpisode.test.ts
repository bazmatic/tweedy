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
