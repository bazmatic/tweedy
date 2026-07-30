import { describe, expect, it } from "vitest";
import {
  checkConversationCompleteSchema,
  createAssignSpeakerRolesSchema,
  createPodcastPlanSchema,
  createSelectNextSpeakerSchema,
  verifyCoveredPointsSchema,
} from "./director-schemas";
import { EpistemicRole, Speaker, VocalProviderName } from "../types";

function makeSpeaker(id: string): Speaker {
  return {
    id,
    slug: id,
    name: `Speaker ${id}`,
    personality: "curious",
    voice: {
      id: `voice-${id}`,
      name: "Voice",
      description: "",
      provider: VocalProviderName.ElevenLabs,
      providerId: "provider-id",
      settings: {},
    },
    voiceStyle: "neutral",
  };
}

describe("director structured-output schemas", () => {
  it("accepts speaker references for programmatic resolution", () => {
    const schema = createSelectNextSpeakerSchema([makeSpeaker("s1")]);

    expect(
      schema.parse({ speakerId: "s1", direction: "Open the episode" })
    ).toEqual({ speakerId: "s1", direction: "Open the episode" });
    expect(
      schema.parse({ speakerId: "Speaker s1", direction: "Open the episode" })
    ).toEqual({ speakerId: "Speaker s1", direction: "Open the episode" });
  });

  it("requires both the plan narrative and discussion points", () => {
    expect(
      createPodcastPlanSchema.parse({
        narrative: "Open warmly, explore the subject, then conclude.",
        points: ["How the signalling works"],
      })
    ).toEqual({
      narrative: "Open warmly, explore the subject, then conclude.",
      points: ["How the signalling works"],
    });
    expect(() =>
      createPodcastPlanSchema.parse({ narrative: "Incomplete plan" })
    ).toThrow();
  });

  it("accepts a central analogy in the plan", () => {
    const parsed = createPodcastPlanSchema.parse({
      points: ["p"],
      narrative: "n",
      centralAnalogy:
        "Solana programs are a public library computer terminal; accounts are USB drives you bring.",
    });
    expect(parsed.centralAnalogy).toContain("USB");
  });

  it("accepts ranked discussion points for adaptive production scheduling", () => {
    const parsed = createPodcastPlanSchema.parse({
      narrative: "n",
      points: [
        {
          text: "The central idea",
          priority: "essential",
          storyValue: 9,
          estimatedTurns: 2,
        },
      ],
    });

    expect(parsed.points[0]).toEqual({
      text: "The central idea",
      priority: "essential",
      storyValue: 9,
      estimatedTurns: 2,
    });
  });

  it("accepts a subject-neutral orientation contract and claim prerequisites", () => {
    const parsed = createPodcastPlanSchema.parse({
      narrative: "Orient, then explore.",
      orientation: {
        subject: "Fungal signalling",
        scope: "Evidence and uncertainty",
        centralQuestion: "When does signalling count as language?",
        requiredClaims: [
          "Fungi produce measurable electrical signals.",
          "Calling those signals language remains disputed.",
        ],
        maxTurns: 2,
      },
      points: [
        {
          text: "Examine the strongest language claim.",
          priority: "essential",
          storyValue: 8,
          estimatedTurns: 3,
          prerequisiteClaimIds: ["o1", "o2"],
        },
      ],
    });

    expect(parsed.orientation?.subject).toBe("Fungal signalling");
    expect(
      typeof parsed.points[0] === "string"
        ? []
        : parsed.points[0].prerequisiteClaimIds
    ).toEqual(["o1", "o2"]);
  });

  it("accepts ordered subject-neutral discourse claims on beats", () => {
    const parsed = createPodcastPlanSchema.parse({
      narrative: "Establish context before payoff.",
      points: ["Cyclops episode"],
      beats: [
        {
          purpose: "illustrate",
          goal: "Explain the Cyclops episode.",
          claims: [
            {
              text: "Odysseus is trapped by Polyphemus.",
              role: "context",
            },
            {
              text: "Odysseus escapes using the name Nobody.",
              role: "action",
              prerequisiteClaimIndexes: [0],
            },
            {
              text: "The trick works because Polyphemus reports that Nobody hurt him.",
              role: "explanation",
              prerequisiteClaimIndexes: [1],
            },
            {
              text: "He reveals his real name and brings Poseidon's anger.",
              role: "surprise",
              prerequisiteClaimIndexes: [2],
            },
          ],
        },
      ],
    });

    expect(parsed.beats?.[0].claims?.[3].prerequisiteClaimIndexes).toEqual([
      2,
    ]);
  });

  it("accepts an oversized orientation suggestion for runtime clamping", () => {
    const parsed = createPodcastPlanSchema.parse({
      narrative: "Orient a completely new listener.",
      points: ["The big picture"],
      orientation: {
        subject: "The Odyssey",
        scope: "A beginner's introduction",
        centralQuestion: "What is the Odyssey about?",
        requiredClaims: ["It is an epic poem.", "Odysseus is trying to return home."],
        maxTurns: 6,
      },
    });

    expect(parsed.orientation?.maxTurns).toBe(6);
  });

  it("accepts unexpected discourse-role labels for semantic normalisation", () => {
    const parsed = createPodcastPlanSchema.parse({
      narrative: "Normalise planner vocabulary without rejecting the plan.",
      points: ["Cyclops episode"],
      beats: [
        {
          purpose: "illustrate",
          goal: "Explain cause and effect.",
          claims: [
            {
              text: "Poseidon prolongs the voyage.",
              role: "consequence",
            },
            {
              text: "The listener sees Odysseus differently.",
              role: "reaction",
            },
          ],
        },
      ],
    });

    expect(parsed.beats?.[0].claims?.map((claim) => claim.role)).toEqual([
      "consequence",
      "reaction",
    ]);
  });

  it("validates coverage verification and conclusion decisions", () => {
    expect(
      verifyCoveredPointsSchema.parse({ confirmedPointIds: ["p1"] })
    ).toEqual({ confirmedPointIds: ["p1"] });
    expect(checkConversationCompleteSchema.parse({ isComplete: true })).toEqual(
      { isComplete: true }
    );
  });
});

describe("createAssignSpeakerRolesSchema", () => {
  const speakers = [
    { id: "s1", name: "Aida" } as Speaker,
    { id: "s2", name: "Miles" } as Speaker,
  ];

  it("accepts a valid role assignment for each speaker", () => {
    const schema = createAssignSpeakerRolesSchema(speakers);
    const result = schema.parse({
      assignments: [
        { speakerId: "s1", epistemicRole: EpistemicRole.InformedHost },
        { speakerId: "s2", epistemicRole: EpistemicRole.AudienceGuide },
      ],
    });
    expect(result.assignments).toHaveLength(2);
  });

  it("falls back to audience_guide for an unrecognised role value", () => {
    const schema = createAssignSpeakerRolesSchema(speakers);
    const result = schema.parse({
      assignments: [{ speakerId: "s1", epistemicRole: "narrator" }],
    });
    expect(result.assignments[0].epistemicRole).toBe(
      EpistemicRole.AudienceGuide
    );
  });
});
