import { describe, expect, it } from "vitest";
import { PodcastScript, Speaker, VocalProviderName } from "../types";
import { EpisodeConclusionPolicy } from "./EpisodeConclusionPolicy";
import { SpeakerAgentToolName } from "./speaker-tools";

function makeSpeaker(): Speaker {
  return {
    id: "host",
    slug: "host",
    name: "Host",
    personality: "warm",
    voice: {
      id: "voice",
      name: "Voice",
      description: "",
      provider: VocalProviderName.ElevenLabs,
      providerId: "provider",
      settings: {},
    },
    voiceStyle: "natural",
    isExpert: false,
  };
}

function makeScript(tool: SpeakerAgentToolName): PodcastScript {
  const speaker = makeSpeaker();
  return {
    id: "script",
    title: "Test",
    description: "",
    speakers: [speaker],
    speeches: [
      {
        id: "speech",
        speaker,
        message: "Thanks for listening. Until next time.",
        instructions: "warm",
        voice: speaker.voice,
        voiceStyle: speaker.voiceStyle,
        timestamp: new Date(),
        tool,
      },
    ],
    materials: [],
    discussionPoints: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("EpisodeConclusionPolicy", () => {
  const policy = new EpisodeConclusionPolicy();

  it("accepts only a dedicated closing statement as the final turn", () => {
    expect(
      policy.hasFinalSignOff(
        makeScript(SpeakerAgentToolName.CLOSING_STATEMENT)
      )
    ).toBe(true);
    expect(
      policy.hasFinalSignOff(
        makeScript(SpeakerAgentToolName.NEARLY_OUT_OF_TIME)
      )
    ).toBe(false);
    expect(
      policy.hasFinalSignOff(makeScript(SpeakerAgentToolName.SUMMARIZE))
    ).toBe(false);
  });
});
