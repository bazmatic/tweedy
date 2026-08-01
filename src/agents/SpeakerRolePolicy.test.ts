import { describe, expect, it } from "vitest";
import {
  AudienceValue,
  EditorialCardKind,
  EditorialMove,
  EnergyLevel,
  EpistemicRole,
  KnowledgeSource,
  PodcastScript,
  SourceAccess,
  Speaker,
  TurnBrief,
  UncertaintyStyle,
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
    roleProfile: isExpert
      ? {
          epistemicRole: EpistemicRole.Expert,
          sourceAccess: SourceAccess.Full,
          uncertaintyStyle: UncertaintyStyle.Precise,
        }
      : {
          epistemicRole: EpistemicRole.AudienceGuide,
          sourceAccess: SourceAccess.HeardOnly,
          uncertaintyStyle: UncertaintyStyle.ListenerSurrogate,
        },
  };
}

function makeInformedHost(id: string): Speaker {
  return {
    id,
    slug: id,
    name: id,
    personality: "well-read",
    voice: {
      id: `voice-${id}`,
      name: "Voice",
      description: "",
      provider: VocalProviderName.ElevenLabs,
      providerId: "provider-id",
      settings: {},
    },
    voiceStyle: "natural",
    roleProfile: {
      epistemicRole: EpistemicRole.InformedHost,
      sourceAccess: SourceAccess.PreparedCards,
      uncertaintyStyle: UncertaintyStyle.Exploratory,
    },
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

  it("falls back to a safe question rather than reassigning an unseen technical explanation, with exactly two speakers", () => {
    // With exactly two speakers, turn order is deterministic ping-pong and
    // the Director's direction is written assuming the proposed speaker
    // delivers it — sometimes naming them directly. Reassigning to the
    // other speaker here would hand them a goal written for someone else,
    // so the policy falls back to a generic safe question instead of
    // swapping speakers.
    const result = policy.repairAssignment(
      makeScript(expert, guide),
      guide,
      makeBrief(guide.id, EditorialMove.Explain),
      "Explain the result."
    );

    expect(result.speaker.id).toBe(guide.id);
    expect(result.turnBrief.speakerId).toBe(guide.id);
    expect(result.repaired).toBe(true);
    expect(result.repairReason).toBe(RoleRepairReason.NoEligibleSpeaker);
    expect(result.turnBrief.move).toBe(EditorialMove.Question);
  });

  it("falls back to a safe question rather than letting a guide introduce a source-heavy illustration, with exactly two speakers", () => {
    const brief = makeBrief(guide.id, EditorialMove.Illustrate);
    brief.cardIds = [];

    const result = policy.repairAssignment(
      makeScript(expert, guide),
      guide,
      brief,
      "Describe the technical finding from the source."
    );

    expect(result.speaker.id).toBe(guide.id);
    expect(result.repaired).toBe(true);
    expect(result.repairReason).toBe(RoleRepairReason.NoEligibleSpeaker);
    expect(result.turnBrief.move).toBe(EditorialMove.Question);
  });

  it("still reassigns to an eligible speaker when there are more than two speakers", () => {
    const thirdGuide = makeSpeaker("guide-2", false);
    const script = makeScript(expert, guide);
    script.speakers = [guide, expert, thirdGuide];

    const result = policy.repairAssignment(
      script,
      guide,
      makeBrief(guide.id, EditorialMove.Explain),
      "Explain the result."
    );

    expect(result.speaker.id).toBe(expert.id);
    expect(result.turnBrief.speakerId).toBe(expert.id);
    expect(result.repaired).toBe(true);
    expect(result.repairReason).toBe(RoleRepairReason.IncompatibleMove);
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
        significance: "",
        evidence: [],
        relatedCardIds: [],
        tags: [],
        keyTerms: [],
        storyValue: 5,
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
        significance: "",
        evidence: [],
        relatedCardIds: [],
        tags: [],
        keyTerms: ["complexity score"],
        storyValue: 5,
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

  it("does not ask a guide to clarify a key term they already used themselves", () => {
    const script = makeScript(expert, guide);
    script.editorialCards = [
      {
        id: "card-1",
        materialId: "material-1",
        kind: EditorialCardKind.EssentialPoint,
        content: "Fungal threads are called hyphae.",
        significance: "",
        evidence: [],
        relatedCardIds: [],
        tags: [],
        keyTerms: ["hyphae"],
        storyValue: 5,
      },
    ];
    script.speeches = [
      {
        id: "speech-1",
        speaker: guide,
        message: "These fungal threads, the hyphae, carry electrical spikes.",
        instructions: "",
        voice: guide.voice,
        voiceStyle: guide.voiceStyle,
        timestamp: new Date(),
      },
    ];
    const brief = makeBrief(guide.id, EditorialMove.Question);
    brief.goal = "Ask about hyphae.";
    brief.cardIds = [];

    const result = policy.repairAssignment(
      script,
      guide,
      brief,
      "Ask Ada what hyphae actually are."
    );

    expect(result.repaired).toBe(false);
    expect(result.repairReason).toBeUndefined();
  });

  it("lets an informed host explain an unexplained key term from their own prepared card", () => {
    const host = makeInformedHost("host");
    const script = makeScript(expert, guide);
    script.speakers = [guide, host, expert];
    script.editorialCards = [
      {
        id: "card-1",
        materialId: "material-1",
        kind: EditorialCardKind.EssentialPoint,
        content: "Fungal spikes are scored for structural complexity.",
        significance: "",
        evidence: [],
        relatedCardIds: [],
        tags: [],
        keyTerms: ["complexity score"],
        storyValue: 5,
      },
    ];
    const brief = makeBrief(host.id, EditorialMove.Explain);
    brief.goal = "Explain what the complexity score means.";
    brief.cardIds = ["card-1"];

    const result = policy.repairAssignment(
      script,
      host,
      brief,
      "Explain the complexity score in plain language."
    );

    expect(result.speaker.id).toBe(host.id);
    expect(result.repaired).toBe(false);
    expect(result.turnBrief.move).toBe(EditorialMove.Explain);
    expect(result.turnBrief.goal).toBe("Explain what the complexity score means.");
  });

  it("allows a guide's direction to name a key term once it has been explained aloud", () => {
    const script = makeScript(expert, guide);
    script.editorialCards = [
      {
        id: "card-1",
        materialId: "material-1",
        kind: EditorialCardKind.EssentialPoint,
        content: "Fungal spikes are scored for structural complexity.",
        significance: "",
        evidence: [],
        relatedCardIds: [],
        tags: [],
        keyTerms: ["complexity score"],
        storyValue: 5,
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
