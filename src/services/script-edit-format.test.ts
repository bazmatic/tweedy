import { describe, expect, it } from "vitest";
import { SpeakerAgentToolName } from "../agents/speaker-tools";
import { PodcastScript, VocalProviderName } from "../types";
import {
  formatScriptForEditing,
  parseEditableScript,
  ScriptEditFormatError,
} from "./script-edit-format";

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
  return {
    id: "script-1",
    title: "Test",
    description: "",
    speakers: [speaker],
    speeches: [
      {
        id: "speech-1",
        speaker,
        message: "First line.\nStill the first turn.",
        instructions: "natural",
        voice: speaker.voice,
        voiceStyle: speaker.voiceStyle,
        timestamp: new Date("2026-07-14T00:00:00.000Z"),
        tool: SpeakerAgentToolName.SPEAK,
      },
    ],
    materials: [],
    discussionPoints: [],
    createdAt: new Date("2026-07-14T00:00:00.000Z"),
    updatedAt: new Date("2026-07-14T01:00:00.000Z"),
  };
}

describe("editable script format", () => {
  it("round-trips script identity, revision and turns", () => {
    const document = parseEditableScript(formatScriptForEditing(makeScript()));

    expect(document).toEqual({
      formatVersion: 1,
      scriptId: "script-1",
      revision: "2026-07-14T01:00:00.000Z",
      turns: [
        {
          sourceId: "speech-1",
          speakerSlug: "ada",
          message: "First line.\nStill the first turn.",
          mode: SpeakerAgentToolName.SPEAK,
        },
      ],
    });
  });

  it("allows multiple new turns and a document with no turns", () => {
    const header = `@format: 1\n@script: script-1\n@revision: 2026-07-14T01:00:00.000Z\n`;
    expect(parseEditableScript(header).turns).toEqual([]);

    const document = parseEditableScript(
      `${header}\n@id: new\n@speaker: ada\nOne.\n\n@id: new\n@speaker: ada\nTwo.\n`
    );
    expect(document.turns).toHaveLength(2);
    expect(document.turns.every((turn) => !turn.sourceId)).toBe(true);
  });

  it("rejects duplicate ids and unknown modes", () => {
    const header = `@format: 1\n@script: script-1\n@revision: revision\n`;
    expect(() =>
      parseEditableScript(
        `${header}@id: speech-1\n@speaker: ada\nOne.\n@id: speech-1\n@speaker: ada\nTwo.\n`
      )
    ).toThrow(ScriptEditFormatError);
    expect(() =>
      parseEditableScript(
        `${header}@id: speech-1\n@speaker: ada\n@mode: monologue\nOne.\n`
      )
    ).toThrow('Unknown turn mode "monologue"');
  });
});
