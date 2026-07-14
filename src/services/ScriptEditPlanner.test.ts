import { describe, expect, it } from "vitest";
import { SpeakerAgentToolName } from "../agents/speaker-tools";
import {
  EditableScriptDocument,
  PodcastScript,
  ScriptEditTurnAction,
  VocalProviderName,
} from "../types";
import {
  ScriptEditPlanner,
  ScriptEditValidationError,
} from "./ScriptEditPlanner";

function makeScript(): PodcastScript {
  const speaker = {
    id: "speaker-1",
    slug: "ada",
    name: "Ada",
    personality: "warm",
    voice: {
      id: "voice-1",
      name: "Voice",
      description: "",
      provider: VocalProviderName.ElevenLabs,
      providerId: "provider-1",
      settings: {},
    },
    voiceStyle: "natural",
    isExpert: false,
  };
  const speeches = ["One", "Two", "Three"].map((message, index) => ({
    id: `speech-${index + 1}`,
    speaker,
    message,
    instructions: "natural",
    voice: speaker.voice,
    voiceStyle: speaker.voiceStyle,
    timestamp: new Date(),
    tool: SpeakerAgentToolName.SPEAK,
  }));
  const secondSpeaker = {
    ...speaker,
    id: "speaker-2",
    slug: "miles",
    name: "Miles",
  };
  return {
    id: "script-1",
    title: "Test",
    description: "",
    speakers: [speaker, secondSpeaker],
    speeches,
    materials: [],
    discussionPoints: [],
    createdAt: new Date("2026-07-14T00:00:00.000Z"),
    updatedAt: new Date("2026-07-14T01:00:00.000Z"),
  };
}

function makeDocument(): EditableScriptDocument {
  return {
    formatVersion: 1,
    scriptId: "script-1",
    revision: "2026-07-14T01:00:00.000Z",
    turns: [],
  };
}

describe("ScriptEditPlanner", () => {
  it("plans edits, additions, removals and reordering without writes", () => {
    const document = makeDocument();
    document.turns = [
      {
        sourceId: "speech-2",
        speakerSlug: "ada",
        message: "Two, edited.",
      },
      { sourceId: "speech-1", speakerSlug: "ada", message: "One" },
      { speakerSlug: "ada", message: "New turn." },
    ];

    const plan = new ScriptEditPlanner().plan(makeScript(), document);

    expect(plan.summary).toEqual({
      added: 1,
      removed: 1,
      edited: 1,
      unchanged: 1,
      reordered: true,
    });
    expect(plan.turns.map((turn) => turn.action)).toEqual([
      ScriptEditTurnAction.Replace,
      ScriptEditTurnAction.Reuse,
      ScriptEditTurnAction.Add,
    ]);
  });

  it("rejects stale files, foreign ids and speaker reassignment", () => {
    const planner = new ScriptEditPlanner();
    const stale = makeDocument();
    stale.revision = "old";
    expect(() => planner.plan(makeScript(), stale)).toThrow(
      ScriptEditValidationError
    );

    const foreign = makeDocument();
    foreign.turns = [
      { sourceId: "foreign", speakerSlug: "ada", message: "No." },
    ];
    expect(() => planner.plan(makeScript(), foreign)).toThrow(
      "does not belong"
    );

    const reassigned = makeDocument();
    reassigned.turns = [
      { sourceId: "speech-1", speakerSlug: "miles", message: "One" },
    ];
    expect(() => planner.plan(makeScript(), reassigned)).toThrow(
      "changing its speaker is not supported"
    );
  });
});
