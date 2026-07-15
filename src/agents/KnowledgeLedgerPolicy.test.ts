import { describe, expect, it } from "vitest";
import {
  AudienceValue,
  EditorialCard,
  EditorialCardKind,
  EditorialMove,
  EnergyLevel,
  KnowledgeSource,
  PodcastScript,
  Speaker,
  Speech,
  VocalProviderName,
} from "../types";
import { KnowledgeLedgerPolicy } from "./KnowledgeLedgerPolicy";

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
    content: "A precise technical fact.",
    evidence: [],
    relatedCardIds: [],
    tags: [],
    keyTerms: [],
  };
}

function makeScript(expert: Speaker, guide: Speaker): PodcastScript {
  return {
    id: "script-1",
    title: "Test",
    description: "",
    speakers: [expert, guide],
    speeches: [],
    materials: [],
    discussionPoints: [],
    editorialCards: [makeCard("card-1")],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeSpeech(speaker: Speaker, accepted: boolean): Speech {
  return {
    id: "speech-1",
    speaker,
    message: "The technical fact.",
    instructions: "natural",
    voice: speaker.voice,
    voiceStyle: speaker.voiceStyle,
    timestamp: new Date(),
    turnBrief: {
      speakerId: speaker.id,
      goal: "Explain the fact.",
      move: EditorialMove.Explain,
      cardIds: ["card-1"],
      audienceValue: AudienceValue.Understanding,
      desiredEnergy: EnergyLevel.Curious,
    },
    review: {
      accepted,
      clear: true,
      engaging: true,
      grounded: true,
      advancesBeat: true,
      addsVariety: true,
      introducedCardIds: ["card-1"],
    },
  };
}

describe("KnowledgeLedgerPolicy", () => {
  const policy = new KnowledgeLedgerPolicy();
  const expert = makeSpeaker("expert", true);
  const guide = makeSpeaker("guide", false);

  it("allows experts to access unseen cards but not audience guides", () => {
    const ledger = policy.createLedger();
    const cards = [makeCard("card-1")];

    expect(policy.getAccessibleCards(expert, cards, ledger, [])).toHaveLength(1);
    expect(policy.getAccessibleCards(guide, cards, ledger, [])).toHaveLength(0);
  });

  it("allows an audience guide to use a card after an accepted introduction", () => {
    const script = makeScript(expert, guide);
    script.knowledgeLedger = policy.createLedger();

    policy.recordAcceptedTurn(script, makeSpeech(expert, true));

    expect(script.knowledgeLedger.introducedCards).toEqual([
      expect.objectContaining({
        cardId: "card-1",
        introducedBySpeakerId: "expert",
        source: KnowledgeSource.SourceMaterial,
      }),
    ]);
    expect(
      policy.getAccessibleCards(
        guide,
        script.editorialCards ?? [],
        script.knowledgeLedger,
        []
      )
    ).toHaveLength(1);
  });

  it("does not learn knowledge from a rejected turn", () => {
    const script = makeScript(expert, guide);
    script.knowledgeLedger = policy.createLedger();

    policy.recordAcceptedTurn(script, makeSpeech(expert, false));

    expect(script.knowledgeLedger.introducedCards).toEqual([]);
  });

  it("rejects invented card ids and inaccessible guide introductions", () => {
    const script = makeScript(expert, guide);
    script.knowledgeLedger = policy.createLedger();
    const speech = makeSpeech(guide, true);
    speech.review!.introducedCardIds = ["card-1", "background"];

    policy.recordAcceptedTurn(script, speech);

    expect(script.knowledgeLedger.introducedCards).toEqual([]);
  });
});
