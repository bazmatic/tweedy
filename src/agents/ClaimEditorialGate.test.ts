import { describe, expect, it, vi } from "vitest";
import {
  DiscourseClaim,
  EmbeddingService,
  EnergyLevel,
  PodcastScript,
  Speech,
  VocalProviderName,
} from "../types";
import { ClaimEditorialGate } from "./ClaimEditorialGate";

const speaker = {
  id: "s1",
  slug: "host",
  name: "Host",
  personality: "curious",
  voice: {
    id: "v1",
    name: "Voice",
    description: "",
    provider: VocalProviderName.ElevenLabs,
    providerId: "voice",
    settings: {},
  },
  voiceStyle: "natural",
};

function speech(message: string): Speech {
  return {
    id: message,
    speaker,
    message,
    instructions: "",
    voice: speaker.voice,
    voiceStyle: speaker.voiceStyle,
    timestamp: new Date(),
  };
}

function script(
  speeches: Speech[] = [],
  discourseClaims: DiscourseClaim[] = []
): PodcastScript {
  return {
    id: "script",
    title: "Episode",
    description: "",
    speakers: [speaker],
    speeches,
    materials: [],
    discussionPoints: [],
    conversationBeats: discourseClaims.length
      ? [
          {
            id: "b1",
            purpose: "explain" as any,
            goal: "Explain",
            cardIds: [],
            prerequisiteBeatIds: [],
            desiredEnergy: EnergyLevel.Curious,
            targetTurns: 2,
            covered: false,
            discourseClaims,
          },
        ]
      : [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function embeddings(
  vectorFor: (text: string) => number[]
): EmbeddingService {
  return {
    embedText: vi.fn(async (text) => vectorFor(text)),
    embedDocuments: vi.fn(async (texts) => texts.map(vectorFor)),
  };
}

describe("ClaimEditorialGate", () => {
  it("rejects semantic repetition across different speakers", async () => {
    const previous = {
      ...speech("Argos recognises Odysseus and then dies after waiting twenty years."),
      speaker: { ...speaker, id: "s2", name: "Expert" },
    };
    const gate = new ClaimEditorialGate(embeddings(() => [1, 0]));

    const result = await gate.evaluate(
      speech("The old dog recognises his returning master and dies immediately."),
      script([previous])
    );

    expect(result).toEqual({
      accepted: false,
      reason: "Candidate substantially repeats claims listeners already heard",
    });
  });

  it("allows a repeated callback when it establishes a new implication", async () => {
    const claims: DiscourseClaim[] = [
      {
        id: "c1",
        beatId: "b1",
        text: "Argos recognises Odysseus.",
        role: "example",
        prerequisiteClaimIds: [],
        state: "established",
        evidenceSpeechIds: ["old"],
        attemptedTurns: 1,
      },
      {
        id: "c2",
        beatId: "b1",
        text: "Recognition shows that homecoming requires being known.",
        role: "implication",
        prerequisiteClaimIds: ["c1"],
        state: "unheard",
        evidenceSpeechIds: [],
        attemptedTurns: 0,
      },
    ];
    const candidate = {
      ...speech(
        "Argos matters because homecoming requires Odysseus to be known again."
      ),
      turnBrief: {
        speakerId: "s1",
        goal: "Explain the implication.",
        move: "find_meaning" as any,
        cardIds: [],
        audienceValue: "understanding" as any,
        desiredEnergy: EnergyLevel.Reflective,
        targetDiscourseClaimIds: ["c2"],
      },
    };
    const gate = new ClaimEditorialGate(embeddings(() => [1, 0]));

    await expect(
      gate.evaluate(
        candidate,
        script(
          [speech("Argos recognises Odysseus after waiting for twenty years.")],
          claims
        )
      )
    ).resolves.toEqual({ accepted: true });
  });

  it("rejects a planned claim spoken before its prerequisites", async () => {
    const claims: DiscourseClaim[] = [
      {
        id: "c1",
        beatId: "b1",
        text: "Odysseus escapes beneath the sheep.",
        role: "action",
        prerequisiteClaimIds: [],
        state: "unheard",
        evidenceSpeechIds: [],
        attemptedTurns: 0,
      },
      {
        id: "c2",
        beatId: "b1",
        text: "Once safe, Odysseus boasts and reveals his name.",
        role: "complication",
        prerequisiteClaimIds: ["c1"],
        state: "unheard",
        evidenceSpeechIds: [],
        attemptedTurns: 0,
      },
    ];
    const gate = new ClaimEditorialGate(
      embeddings((text) =>
        text.includes("boast") || text.includes("reveals") ? [0, 1] : [1, 0]
      )
    );

    const result = await gate.evaluate(
      speech("Once safely away, Odysseus boasts loudly and reveals his true name."),
      script([], claims)
    );

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("c2");
  });

  it("fails open when local embeddings are unavailable", async () => {
    const gate = new ClaimEditorialGate({
      embedText: vi.fn().mockRejectedValue(new Error("offline")),
      embedDocuments: vi.fn().mockRejectedValue(new Error("offline")),
    });

    await expect(
      gate.evaluate(
        speech("This is a sufficiently substantive candidate proposition for listeners."),
        script([speech("This earlier proposition may be semantically similar.")])
      )
    ).resolves.toEqual({ accepted: true });
  });
});
