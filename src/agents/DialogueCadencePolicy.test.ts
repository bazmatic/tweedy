import { describe, expect, it } from "vitest";
import {
  AudienceValue,
  EditorialMove,
  EnergyLevel,
  PodcastScript,
  Speaker,
  Speech,
  VocalProviderName,
} from "../types";
import { DialogueCadencePolicy } from "./DialogueCadencePolicy";
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

function makeSpeech(speaker: Speaker): Speech {
  return {
    id: "speech-1",
    speaker,
    message: "Um, here is the first technical explanation.",
    instructions: "natural",
    voice: speaker.voice,
    voiceStyle: speaker.voiceStyle,
    timestamp: new Date(),
    tool: SpeakerAgentToolName.SPEAK,
  };
}

describe("DialogueCadencePolicy", () => {
  it("turns a consecutive expert explanation into a guide question", () => {
    const expert = makeSpeaker("Miles", true);
    const guide = makeSpeaker("Ada", false);
    const script: PodcastScript = {
      id: "script-1",
      title: "Test",
      description: "",
      speakers: [expert, guide],
      speeches: [makeSpeech(expert)],
      materials: [],
      discussionPoints: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const result = new DialogueCadencePolicy().repairAssignment(script, {
      speaker: expert,
      direction: "Explain the next result.",
      turnBrief: {
        speakerId: expert.id,
        goal: "Explain the next result.",
        move: EditorialMove.Explain,
        cardIds: ["card-2"],
        audienceValue: AudienceValue.Understanding,
        desiredEnergy: EnergyLevel.Curious,
      },
      repaired: false,
    });

    expect(result.speaker.id).toBe(guide.id);
    expect(result.turnBrief.move).toBe(EditorialMove.Question);
    expect(result.turnBrief.cardIds).toEqual([]);
    expect(result.direction).toContain("without stating the answer yourself");
  });

  it("does not interrupt an expert who is answering the guide", () => {
    const expert = makeSpeaker("Miles", true);
    const guide = makeSpeaker("Ada", false);
    const script: PodcastScript = {
      id: "script-1",
      title: "Test",
      description: "",
      speakers: [expert, guide],
      speeches: [makeSpeech(guide)],
      materials: [],
      discussionPoints: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const assignment = {
      speaker: expert,
      direction: "Answer Ada.",
      turnBrief: {
        speakerId: expert.id,
        goal: "Answer Ada.",
        move: EditorialMove.Explain,
        cardIds: [],
        audienceValue: AudienceValue.Understanding,
        desiredEnergy: EnergyLevel.Curious,
      },
      repaired: false,
    };

    expect(
      new DialogueCadencePolicy().repairAssignment(script, assignment)
    ).toEqual(assignment);
  });
});
