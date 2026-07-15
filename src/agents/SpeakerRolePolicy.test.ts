import { describe, expect, it } from "vitest";
import {
  AudienceValue,
  EditorialCardKind,
  EditorialMove,
  EnergyLevel,
  KnowledgeSource,
  PodcastScript,
  Speaker,
  TurnBrief,
  VocalProviderName,
} from "../types";
import { RoleRepairReason, SpeakerRolePolicy } from "./SpeakerRolePolicy";

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

function makeBrief(speakerId: string, move: EditorialMove): TurnBrief {
  return {
    speakerId,
    goal: "Introduce the precise experimental result.",
    move,
    cardIds: ["card-1"],
    audienceValue: AudienceValue.Understanding,
    desiredEnergy: EnergyLevel.Curious,
  };
}

function makeScript(expert: Speaker, guide: Speaker): PodcastScript {
  return {
    id: "script-1",
    title: "Test",
    description: "",
    speakers: [guide, expert],
    speeches: [],
    materials: [],
    discussionPoints: [],
    knowledgeLedger: { introducedCards: [] },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("SpeakerRolePolicy", () => {
  const policy = new SpeakerRolePolicy();
  const expert = makeSpeaker("expert", true);
  const guide = makeSpeaker("guide", false);

  it("reassigns an unseen technical explanation from guide to expert", () => {
    const result = policy.repairAssignment(
      makeScript(expert, guide),
      guide,
      makeBrief(guide.id, EditorialMove.Explain),
      "Explain the result."
    );

    expect(result.speaker.id).toBe(expert.id);
    expect(result.turnBrief.speakerId).toBe(expert.id);
    expect(result.repaired).toBe(true);
    expect(result.repairReason).toBe(RoleRepairReason.IncompatibleMove);
  });

  it("does not let a guide introduce a source-heavy illustration before the expert", () => {
    const brief = makeBrief(guide.id, EditorialMove.Illustrate);
    brief.cardIds = [];

    const result = policy.repairAssignment(
      makeScript(expert, guide),
      guide,
      brief,
      "Describe the technical finding from the source."
    );

    expect(result.speaker.id).toBe(expert.id);
    expect(result.repaired).toBe(true);
    expect(result.repairReason).toBe(RoleRepairReason.InaccessibleKnowledge);
  });

  it("keeps listener-centred questions with the audience guide", () => {
    const brief = makeBrief(guide.id, EditorialMove.Question);
    const script = makeScript(expert, guide);
    script.editorialCards = [
      {
        id: "card-1",
        materialId: "material-1",
        kind: EditorialCardKind.EssentialPoint,
        content: "An unseen technical fact.",
        evidence: [],
        relatedCardIds: [],
        tags: [],
        keyTerms: [],
      },
    ];

    const result = policy.repairAssignment(
      script,
      guide,
      brief,
      "Ask for clarification."
    );

    expect(result.speaker.id).toBe(guide.id);
    expect(result.repaired).toBe(true);
    expect(result.turnBrief.cardIds).toEqual([]);
    expect(result.direction).toContain("Do not state technical detail");
  });

  it("allows a guide to summarise knowledge already introduced aloud", () => {
    const script = makeScript(expert, guide);
    script.knowledgeLedger?.introducedCards.push({
      cardId: "card-1",
      introducedBySpeakerId: expert.id,
      introducedAtTurn: 1,
      source: KnowledgeSource.SourceMaterial,
    });

    const result = policy.repairAssignment(
      script,
      guide,
      makeBrief(guide.id, EditorialMove.Summarise),
      "Summarise the result."
    );

    expect(result.speaker.id).toBe(guide.id);
    expect(result.repaired).toBe(false);
  });

  it("redirects a guide's direction that names an unexplained key term", () => {
    const script = makeScript(expert, guide);
    script.editorialCards = [
      {
        id: "card-1",
        materialId: "material-1",
        kind: EditorialCardKind.EssentialPoint,
        content: "Fungal spikes are scored for structural complexity.",
        evidence: [],
        relatedCardIds: [],
        tags: [],
        keyTerms: ["complexity score"],
      },
    ];
    const brief = makeBrief(guide.id, EditorialMove.Question);
    brief.goal = "Ask about the complexity score.";
    brief.cardIds = [];

    const result = policy.repairAssignment(
      script,
      guide,
      brief,
      "Ask Ada what the complexity score actually measures."
    );

    expect(result.speaker.id).toBe(guide.id);
    expect(result.repaired).toBe(true);
    expect(result.repairReason).toBe(RoleRepairReason.UnexplainedTerminology);
    expect(result.direction).toContain('"complexity score"');
    expect(result.direction).toContain(`ask ${expert.name}`);
    expect(result.turnBrief.move).toBe(EditorialMove.Question);
  });

  it("allows a guide's direction to name a key term once it has been explained aloud", () => {
    const script = makeScript(expert, guide);
    script.editorialCards = [
      {
        id: "card-1",
        materialId: "material-1",
        kind: EditorialCardKind.EssentialPoint,
        content: "Fungal spikes are scored for structural complexity.",
        evidence: [],
        relatedCardIds: [],
        tags: [],
        keyTerms: ["complexity score"],
      },
    ];
    script.terminologyLedger = {
      explainedTerms: [
        {
          term: "complexity score",
          plainLanguageMeaning: "A measure of pattern variety in the signal.",
          explainedBySpeakerId: expert.id,
          explainedAtTurn: 1,
        },
      ],
    };
    const brief = makeBrief(guide.id, EditorialMove.Question);
    brief.goal = "Ask a follow-up about the complexity score.";
    brief.cardIds = [];

    const result = policy.repairAssignment(
      script,
      guide,
      brief,
      "Ask Ada a follow-up about the complexity score."
    );

    expect(result.speaker.id).toBe(guide.id);
    expect(result.repaired).toBe(false);
  });
});
