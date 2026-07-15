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
import {
  DialogueCadencePolicy,
  CadenceRepairReason,
} from "./DialogueCadencePolicy";
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

function buildSpeech(
  speaker: Speaker,
  message: string,
  tool: SpeakerAgentToolName
): Speech {
  return {
    id: `speech-${Math.random()}`,
    speaker,
    message,
    instructions: "natural",
    voice: speaker.voice,
    voiceStyle: speaker.voiceStyle,
    timestamp: new Date(),
    tool,
  };
}

function buildScript(speeches: Speech[]): PodcastScript {
  const speakers = Array.from(
    new Map(speeches.map((s) => [s.speaker.id, s.speaker])).values()
  );
  return {
    id: "script-1",
    title: "Test",
    description: "",
    speakers,
    speeches,
    materials: [],
    discussionPoints: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function buildAssignment(speaker: Speaker) {
  return {
    speaker,
    direction: "Continue speaking.",
    turnBrief: {
      speakerId: speaker.id,
      goal: "Advance the discussion.",
      move: EditorialMove.Explain,
      cardIds: [],
      audienceValue: AudienceValue.Understanding,
      desiredEnergy: EnergyLevel.Curious,
    },
    repaired: false,
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

  describe("resume after backchannel", () => {
    it("returns the floor to the interrupted speaker after a filler comment", () => {
      const expert = makeSpeaker("Miles", true);
      const guide = makeSpeaker("Ada", false);
      const policy = new DialogueCadencePolicy();
      const script = buildScript([
        buildSpeech(
          expert,
          "So the account model is completely different because—",
          SpeakerAgentToolName.EXPLAIN
        ),
        buildSpeech(guide, "Oh, wow.", SpeakerAgentToolName.FILLER_COMMENT),
      ]);
      const result = policy.repairAssignment(script, buildAssignment(guide));
      expect(result.speaker.id).toBe(expert.id);
      expect(result.cadenceRepairReason).toBe(
        CadenceRepairReason.ResumeAfterBackchannel
      );
      expect(result.direction).toMatch(/continue/i);
    });

    it("does not repair when the director already picked the interrupted speaker", () => {
      const expert = makeSpeaker("Miles", true);
      const guide = makeSpeaker("Ada", false);
      const policy = new DialogueCadencePolicy();
      const script = buildScript([
        buildSpeech(
          expert,
          "So the account model is completely different.",
          SpeakerAgentToolName.SPEAK
        ),
        buildSpeech(guide, "Right.", SpeakerAgentToolName.INTERJECT),
      ]);
      const result = policy.repairAssignment(script, buildAssignment(expert));
      expect(result.cadenceRepairReason).toBeUndefined();
    });

    it("does not fire when the backchannel followed a short question", () => {
      const expert = makeSpeaker("Miles", true);
      const guide = makeSpeaker("Ada", false);
      const policy = new DialogueCadencePolicy();
      const script = buildScript([
        buildSpeech(
          expert,
          "But what does that mean for gas?",
          SpeakerAgentToolName.SHORT_QUESTION
        ),
        buildSpeech(guide, "Hm, interesting.", SpeakerAgentToolName.FILLER_COMMENT),
      ]);
      const result = policy.repairAssignment(script, buildAssignment(guide));
      expect(result.cadenceRepairReason).not.toBe(
        CadenceRepairReason.ResumeAfterBackchannel
      );
    });
  });
});
