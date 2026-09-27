import { beforeEach, describe, expect, it } from "vitest";
import {
  BeatPurpose,
  DiscourseClaim,
  EnergyLevel,
  PodcastScript,
  Speaker,
  Speech,
  VocalProviderName,
} from "../types";
import { setJudgmentProvider } from "../services/judgment-runtime";
import { scriptedProvider, unavailableProvider } from "../test-support/judgments";
import { JudgmentQuestion } from "../providers/judgment-questions";
import { DirectorAgent } from "./DirectorAgent";

const speaker: Speaker = {
  id: "s1",
  slug: "s1",
  name: "Ada",
  personality: "curious",
  voice: { id: "v", name: "V", description: "", provider: VocalProviderName.ElevenLabs, providerId: "p", settings: {} },
  voiceStyle: "neutral",
};

const claim = (
  id: string,
  text: string,
  state: DiscourseClaim["state"] = "unheard",
  prerequisiteClaimIds: string[] = []
): DiscourseClaim => ({
  id,
  beatId: "b1",
  text,
  role: "explanation" as DiscourseClaim["role"],
  prerequisiteClaimIds,
  state,
  evidenceSpeechIds: [],
  attemptedTurns: 0,
});

function setup() {
  const claims = [
    claim("c1", "Most AI models write text"),
    claim("c2", "Jev returns typed decisions instead of text", "unheard", ["c1"]),
    claim("c3", "Jev is fast", "established"),
    claim("c4", "Jev replaced every chatbot", "unresolved"),
    claim("c5", "The benchmarks are company-run", "unheard", ["c2"]),
  ];
  const script = {
    id: "script",
    title: "t",
    description: "d",
    speakers: [speaker],
    speeches: [],
    materials: [],
    discussionPoints: [],
    conversationBeats: [
      {
        id: "b1",
        purpose: "explain" as BeatPurpose,
        goal: "g",
        cardIds: [],
        prerequisiteBeatIds: [],
        desiredEnergy: EnergyLevel.Curious,
        targetTurns: 3,
        covered: false,
        discourseClaims: claims,
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as PodcastScript;
  const agent = new DirectorAgent(script, { maxTurns: 10, maxDuration: 600 });
  const speech = {
    id: "turn-1",
    speaker,
    message: "Unlike chatbots, Jev hands back typed decisions, not text.",
    instructions: "",
    voice: speaker.voice,
    voiceStyle: speaker.voiceStyle,
    timestamp: new Date(),
  } as Speech;
  script.speeches.push(speech);
  return { agent, script, speech, claims };
}

/** Answers "established" for any question whose text mentions one of `established`. */
function establishedProvider(established: string[]) {
  const asked: string[][] = [];
  const provider = scriptedProvider((_id, question: JudgmentQuestion) => {
    asked.push([question.instructions]);
    return {
      type: "noul",
      probability: established.some((text) => question.instructions.includes(text)) ? 0.9 : 0.1,
    };
  });
  return { provider, asked };
}

describe("DirectorAgent opportunistic discourse coverage", () => {
  beforeEach(() => {
    setJudgmentProvider(unavailableProvider());
  });

  it("sweeps every unheard claim, even with unrecorded prerequisites", async () => {
    const { provider, asked } = establishedProvider([
      "Most AI models write text",
      "Jev returns typed decisions instead of text",
    ]);
    setJudgmentProvider(provider);
    const { agent, script, speech, claims } = setup();

    await agent.recordAcceptedCoverage(script, speech);

    const askedText = asked.flat().join("\n");
    expect(askedText).toContain("Most AI models write text");
    expect(askedText).toContain("Jev returns typed decisions instead of text");
    expect(askedText).toContain("The benchmarks are company-run");
    expect(askedText).not.toContain("Jev is fast");
    expect(askedText).not.toContain("Jev replaced every chatbot");
    expect(claims.find((c) => c.id === "c1")?.state).toBe("established");
    expect(claims.find((c) => c.id === "c2")?.state).toBe("established");
    expect(claims.find((c) => c.id === "c2")?.evidenceSpeechIds).toEqual(["turn-1"]);
    // Not established by this turn, and never attempted: stays unheard, not unresolved.
    expect(claims.find((c) => c.id === "c5")?.state).toBe("unheard");
  });

  it("leaves every claim unheard when the provider is unavailable", async () => {
    setJudgmentProvider(unavailableProvider());
    const { agent, script, speech, claims } = setup();
    await agent.recordAcceptedCoverage(script, speech);
    expect(claims.filter((c) => c.state === "established").map((c) => c.id)).toEqual(["c3"]);
  });
});
