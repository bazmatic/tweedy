import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BeatPurpose,
  DiscourseClaim,
  EnergyLevel,
  PodcastScript,
  Speaker,
  Speech,
  VocalProviderName,
} from "../types";
import { JudgmentRunner } from "../services/JudgmentRunner";
import { parseJudgmentModes, resolveJudgmentMode } from "../services/judgment-modes";
import { JudgmentQuestions } from "../providers/judgment-questions";
import { DirectorAgent } from "./DirectorAgent";

// The judgment runtime is swapped per test: `modes` sets the rollout, and
// the scripted provider says which claims the transcript establishes.
const { runtime } = vi.hoisted(() => ({
  runtime: { modes: "", established: new Set<string>(), asked: [] as string[][] },
}));
vi.mock("../services/judgment-runtime", () => ({
  judgmentMode: (name: string) => resolveJudgmentMode(parseJudgmentModes(runtime.modes), name),
  getJudgmentRunner: () =>
    new JudgmentRunner(parseJudgmentModes(runtime.modes), {
      append: async () => {},
      readAll: async () => [],
    }),
  getJudgmentProvider: () => ({
    judge: async (_state: unknown, questions: JudgmentQuestions) => {
      const texts = Object.values(questions).map((q) => q.instructions);
      runtime.asked.push(texts);
      return {
        status: "ok",
        answers: Object.fromEntries(
          Object.entries(questions).map(([id, q]) => [
            id,
            {
              type: "noul",
              probability: [...runtime.established].some((text) => q.instructions.includes(text))
                ? 0.9
                : 0.1,
            },
          ])
        ),
      };
    },
  }),
}));

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

describe("DirectorAgent opportunistic discourse coverage", () => {
  beforeEach(() => {
    runtime.asked = [];
    runtime.established = new Set();
  });

  it("with TypeSafe on, sweeps every unheard claim, even with unrecorded prerequisites", async () => {
    runtime.modes = "coverage.discourse=on";
    runtime.established = new Set(["Most AI models write text", "Jev returns typed decisions instead of text"]);
    const { agent, script, speech, claims } = setup();

    await agent.recordAcceptedCoverage(script, speech);

    const asked = runtime.asked.flat().join("\n");
    expect(asked).toContain("Most AI models write text");
    expect(asked).toContain("Jev returns typed decisions instead of text");
    expect(asked).toContain("The benchmarks are company-run");
    expect(asked).not.toContain("Jev is fast");
    expect(asked).not.toContain("Jev replaced every chatbot");
    expect(claims.find((c) => c.id === "c1")?.state).toBe("established");
    expect(claims.find((c) => c.id === "c2")?.state).toBe("established");
    expect(claims.find((c) => c.id === "c2")?.evidenceSpeechIds).toEqual(["turn-1"]);
    // Not established by this turn, and never attempted: stays unheard, not unresolved.
    expect(claims.find((c) => c.id === "c5")?.state).toBe("unheard");
  });

  it("off: keeps the LLM path's small, prerequisite-ready bound", async () => {
    runtime.modes = "";
    const { agent, script, speech } = setup();
    const call = vi
      .spyOn(agent as any, "callModelForStructuredOutput")
      .mockResolvedValue({ confirmedPointIds: [] });

    await agent.recordAcceptedCoverage(script, speech);

    const prompt = (call.mock.calls[0][1] as { content: string }[])[0].content;
    expect(prompt).toContain("c1: Most AI models write text");
    // c2 and c5 wait on unestablished prerequisites, so the LLM path skips them.
    expect(prompt).not.toContain("c2:");
    expect(prompt).not.toContain("c5:");
    expect(runtime.asked).toEqual([]);
  });

  it("shadow: behaves like off, since shadow must not change what is decided", async () => {
    runtime.modes = "coverage.discourse=shadow";
    const { agent, script, speech } = setup();
    const call = vi
      .spyOn(agent as any, "callModelForStructuredOutput")
      .mockResolvedValue({ confirmedPointIds: [] });

    await agent.recordAcceptedCoverage(script, speech);

    const prompt = (call.mock.calls[0][1] as { content: string }[])[0].content;
    expect(prompt).not.toContain("c2:");
  });
});
