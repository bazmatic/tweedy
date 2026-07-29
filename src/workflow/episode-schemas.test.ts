import { describe, expect, it } from "vitest";
import {
  createInitialEpisodeState,
  EpisodeDefinitionSchema,
  EpisodeStateSchema,
} from "./episode-schemas";

const definition = EpisodeDefinitionSchema.parse({
  episodeId: "ep-1",
  workflowRunId: "run-1",
  discussionPointIds: ["dp-1", "dp-2"],
  conversationBeatIds: ["beat-1"],
  speakerIds: ["speaker-1", "speaker-2"],
});

describe("createInitialEpisodeState", () => {
  it("produces a schema-valid preparing-phase state seeded from the definition", () => {
    const state = createInitialEpisodeState(definition);

    expect(() => EpisodeStateSchema.parse(state)).not.toThrow();
    expect(state.phase).toBe("preparing");
    expect(state.episodeId).toBe("ep-1");
    expect(state.workflowRunId).toBe("run-1");
    expect(state.discussionPoints).toEqual([
      { id: "dp-1", covered: false },
      { id: "dp-2", covered: false },
    ]);
    expect(state.conversationBeats).toEqual([{ id: "beat-1", covered: false }]);
    expect(state.turnsUsed).toBe(0);
    expect(state.lateStageTurns).toBe(0);
    expect(state.openingCursor).toBe(0);
    expect(state.speakerRoleAssignments).toEqual({});
    expect(state.acceptedSpeechIds).toEqual([]);
    expect(state.pendingTurn).toBeNull();
    expect(state.terminationRequested).toBe(false);
    expect(state.warnings).toEqual([]);
    expect(state.lastAppliedEvent).toBeNull();
  });

  it("rejects a definition missing required fields", () => {
    expect(() => EpisodeDefinitionSchema.parse({ episodeId: "ep-1" })).toThrow();
  });
});
