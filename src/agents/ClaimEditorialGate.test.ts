import { describe, expect, it } from "vitest";
import {
  DiscourseClaim,
  EnergyLevel,
  PodcastScript,
  Speech,
  VocalProviderName,
} from "../types";
import { ClaimEditorialGate } from "./ClaimEditorialGate";
import { SpeakerAgentToolName } from "./speaker-tools";
import { setJudgmentProvider } from "../services/judgment-runtime";
import { nouls, unavailableProvider } from "../test-support/judgments";

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

describe("ClaimEditorialGate", () => {
  it("accepts a closing statement without a call", async () => {
    setJudgmentProvider(unavailableProvider());
    const gate = new ClaimEditorialGate();

    const candidate = {
      ...speech("So that's Apollo 13 — a near-disaster turned triumph."),
      tool: SpeakerAgentToolName.CLOSING_STATEMENT,
    };

    await expect(gate.evaluate(candidate, script())).resolves.toEqual({
      accepted: true,
    });
  });

  it("accepts a turn under 5 words without a call", async () => {
    setJudgmentProvider(unavailableProvider());
    const gate = new ClaimEditorialGate();

    await expect(gate.evaluate(speech("Oh, wow."), script())).resolves.toEqual({
      accepted: true,
    });
  });

  it("rejects a claim stated before its prerequisites", async () => {
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
    setJudgmentProvider(nouls({ states_claim_before_prerequisites_c2: 0.9 }));
    const gate = new ClaimEditorialGate();

    const result = await gate.evaluate(
      speech("Once safely away, Odysseus boasts loudly and reveals his true name."),
      script([], claims)
    );

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("c2");
  });

  it("rejects repetition", async () => {
    const previous = {
      ...speech("Argos recognises Odysseus and then dies after waiting twenty years."),
      speaker: { ...speaker, id: "s2", name: "Expert" },
    };
    setJudgmentProvider(nouls({ repeats_what_listeners_already_heard: 0.9 }));
    const gate = new ClaimEditorialGate();

    const result = await gate.evaluate(
      speech("The old dog recognises his returning master and dies immediately."),
      script([previous])
    );

    expect(result).toEqual({
      accepted: false,
      reason: "Candidate substantially repeats claims listeners already heard",
    });
  });

  it("accepts repetition that establishes a target", async () => {
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
    setJudgmentProvider(
      nouls({
        repeats_what_listeners_already_heard: 0.9,
        establishes_planned_claim_c2: 0.8,
      })
    );
    const gate = new ClaimEditorialGate();

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
});
