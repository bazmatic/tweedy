import { describe, expect, it } from "vitest";
import {
  AudienceValue,
  EditorialMove,
  EnergyLevel,
  Speaker,
  Speech,
  VocalProviderName,
} from "../types";
import { ResponseModePolicy } from "./ResponseModePolicy";
import { SpeakerAgentToolName } from "./speaker-tools";

function makeSpeaker(id: string, isExpert: boolean): Speaker {
  return {
    id,
    slug: id,
    name: id,
    personality: "curious",
    voice: {
      id: `voice-${id}`,
      name: "Voice",
      description: "",
      provider: VocalProviderName.ElevenLabs,
      providerId: "provider-id",
      settings: {},
    },
    voiceStyle: "natural",
    isExpert,
  };
}

function makeQuestion(speaker: Speaker): Speech {
  return {
    id: "speech-1",
    speaker,
    message: "What did the researchers find?",
    instructions: "curious",
    voice: speaker.voice,
    voiceStyle: speaker.voiceStyle,
    timestamp: new Date(),
    tool: SpeakerAgentToolName.SHORT_QUESTION,
  };
}

describe("ResponseModePolicy", () => {
  const policy = new ResponseModePolicy();
  const expert = makeSpeaker("expert", true);
  const guide = makeSpeaker("guide", false);

  it("offers substantive tools when an expert owes an answer", () => {
    const tools = policy.selectTools({
      speaker: expert,
      speeches: [makeQuestion(guide)],
      isSolo: false,
      isFinalTurn: false,
      forceNearlyOutOfTime: false,
      requestSummary: false,
    });

    expect(tools).toContain(SpeakerAgentToolName.SPEAK);
    expect(tools).not.toContain(SpeakerAgentToolName.INTERJECT);
    expect(tools).not.toContain(SpeakerAgentToolName.SHORT_QUESTION);
  });

  it("maps a listener reaction brief to short reaction tools", () => {
    const tools = policy.selectTools({
      speaker: guide,
      speeches: [],
      isSolo: false,
      isFinalTurn: false,
      forceNearlyOutOfTime: false,
      requestSummary: false,
      turnBrief: {
        speakerId: guide.id,
        goal: "React for the listener.",
        move: EditorialMove.React,
        cardIds: [],
        audienceValue: AudienceValue.Connection,
        desiredEnergy: EnergyLevel.Curious,
      },
    });

    expect(tools).toContain(SpeakerAgentToolName.INTERJECT);
    expect(tools).not.toContain(SpeakerAgentToolName.SPEAK);
  });

  it("does not force a short reaction merely because the previous turn was substantive", () => {
    const previous = makeQuestion(guide);
    previous.message = "Here is a substantive statement.";
    previous.tool = SpeakerAgentToolName.SPEAK;

    const tools = policy.selectTools({
      speaker: expert,
      speeches: [previous],
      isSolo: false,
      isFinalTurn: false,
      forceNearlyOutOfTime: false,
      requestSummary: false,
    });

    expect(tools).toContain(SpeakerAgentToolName.SPEAK);
  });
});
