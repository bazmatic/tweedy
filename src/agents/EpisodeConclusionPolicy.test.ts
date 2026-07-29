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

  it("rejects a closing label when the spoken text is not actually a sign-off", () => {
    const script = makeScript(SpeakerAgentToolName.CLOSING_STATEMENT);
    script.speeches[0].message =
      "The olive tree symbolises peace and rootedness in Ithaca.";

    expect(policy.hasFinalSignOff(script)).toBe(false);
  });

  it("rejects a truncated or question-ending closing", () => {
    const truncated = makeScript(SpeakerAgentToolName.CLOSING_STATEMENT);
    truncated.speeches[0].stopReason = "max_tokens";
    expect(policy.hasFinalSignOff(truncated)).toBe(false);

    const question = makeScript(SpeakerAgentToolName.CLOSING_STATEMENT);
    question.speeches[0].message =
      "Thanks for listening. What should we explore next?";
    expect(policy.hasFinalSignOff(question)).toBe(false);
  });
});
