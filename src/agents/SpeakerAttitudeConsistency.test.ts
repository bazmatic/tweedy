import { describe, expect, it } from "vitest";
import {
  AudienceValue,
  EditorialCard,
  EditorialCardKind,
  EditorialMove,
  EnergyLevel,
  PodcastScript,
  Speaker,
  Speech,
  VocalProviderName,
} from "../types";
import { KnowledgeLedgerPolicy } from "./KnowledgeLedgerPolicy";
import { NaturalSpeechStylePolicy } from "./NaturalSpeechStylePolicy";
import { ResponseModePolicy } from "./ResponseModePolicy";
import { SpeakerRolePolicy } from "./SpeakerRolePolicy";
import { SpeakerRoleProfileResolver } from "./SpeakerRoleProfileResolver";
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

function makeCard(id: string): EditorialCard {
  return {
    id,
    materialId: "material-1",
    kind: EditorialCardKind.EssentialPoint,
    content: `Technical fact ${id}`,
    evidence: [],
    relatedCardIds: [],
    tags: [],
    keyTerms: [],
  };
}

describe("speaker attitude consistency flow", () => {
  it("keeps new facts with the expert, then lets the guide summarise heard knowledge naturally", () => {
    const expert = makeSpeaker("Miles", true);
    const guide = makeSpeaker("Ada", false);
    const cards = [makeCard("card-1"), makeCard("card-2")];
    const script: PodcastScript = {
      id: "script-1",
      title: "Test",
      description: "",
      speakers: [expert, guide],
      speeches: [],
      materials: [],
      discussionPoints: [],
      editorialCards: cards,
      knowledgeLedger: { introducedCards: [] },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const ledgerPolicy = new KnowledgeLedgerPolicy();
    const rolePolicy = new SpeakerRolePolicy();

    const newFactAssignment = rolePolicy.repairAssignment(
      script,
      guide,
      {
        speakerId: guide.id,
        goal: "Explain card one.",
        move: EditorialMove.Explain,
        cardIds: [cards[0].id],
        audienceValue: AudienceValue.Understanding,
        desiredEnergy: EnergyLevel.Curious,
      },
      "Explain card one."
    );
    expect(newFactAssignment.speaker.id).toBe(expert.id);

    const expertSpeech: Speech = {
      id: "speech-1",
      speaker: expert,
      message: "Um, the first result is precise.",
      instructions: "natural",
      voice: expert.voice,
      voiceStyle: expert.voiceStyle,
      timestamp: new Date(),
      tool: SpeakerAgentToolName.SPEAK,
      turnBrief: newFactAssignment.turnBrief,
      review: {
        accepted: true,
        clear: true,
        engaging: true,
        grounded: true,
        advancesBeat: true,
        addsVariety: true,
        roleConsistent: true,
        knowledgeConsistent: true,
        introducedCardIds: [cards[0].id],
      },
    };
    ledgerPolicy.recordAcceptedTurn(script, expertSpeech);
    script.speeches.push(expertSpeech);

    const summaryAssignment = rolePolicy.repairAssignment(
      script,
      guide,
      {
        speakerId: guide.id,
        goal: "Summarise card one for listeners.",
        move: EditorialMove.Summarise,
        cardIds: [cards[0].id],
        audienceValue: AudienceValue.Understanding,
        desiredEnergy: EnergyLevel.Curious,
      },
      "Summarise card one."
    );
    expect(summaryAssignment.speaker.id).toBe(guide.id);
    expect(summaryAssignment.repaired).toBe(false);

    const unseenSecondFact = rolePolicy.repairAssignment(
      script,
      guide,
      {
        ...summaryAssignment.turnBrief,
        goal: "Explain card two.",
        move: EditorialMove.Explain,
        cardIds: [cards[1].id],
      },
      "Explain card two."
    );
    expect(unseenSecondFact.speaker.id).toBe(expert.id);

    const question: Speech = {
      ...expertSpeech,
      id: "speech-2",
      speaker: guide,
      message: "So, um, what does the second result mean?",
      tool: SpeakerAgentToolName.SHORT_QUESTION,
    };
    const responseTools = new ResponseModePolicy().selectTools({
      speaker: expert,
      speeches: [question],
      isSolo: false,
      isFinalTurn: false,
      forceNearlyOutOfTime: false,
      requestSummary: false,
    });
    expect(responseTools).toContain(SpeakerAgentToolName.SPEAK);
    expect(responseTools).not.toContain(SpeakerAgentToolName.INTERJECT);

    const expertProfile = new SpeakerRoleProfileResolver().resolve(expert);
    const naturalGuidance = new NaturalSpeechStylePolicy().buildGuidance(
      expertProfile
    );
    expect(naturalGuidance).toContain("um, uh, like and you know");
  });
});
