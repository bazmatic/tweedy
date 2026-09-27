import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  AudienceValue,
  EditorialMove,
  EnergyLevel,
  Speech,
  VocalProviderName,
} from "../types";
import { ModelTask } from "../providers/ModelRoutingPolicy";
import { setJudgmentProvider } from "../services/judgment-runtime";
import { TURN_REJECTION_REASONS } from "./TypeSafeTurnReviewJudge";
import { TurnReviewerAgent } from "./TurnReviewerAgent";

// Scripts the judgment provider directly, so no network or live model is used.
const judgeMock = vi.fn();

beforeEach(() => {
  judgeMock.mockReset();
  setJudgmentProvider({ judge: judgeMock });
});

const speaker = {
  id: "s1",
  slug: "s1",
  name: "Ada",
  personality: "warm",
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

const speech: Speech = {
  id: "sp1",
  speaker,
  message: "A CO2 scrubber is the filter that pulls exhaled carbon dioxide out of the cabin air.",
  instructions: "explain",
  voice: speaker.voice,
  voiceStyle: speaker.voiceStyle,
  timestamp: new Date(),
};

const brief = {
  speakerId: "s1",
  goal: "Explain what the scrubber does.",
  move: EditorialMove.Explain,
  cardIds: ["c1"],
  audienceValue: AudienceValue.Understanding,
  desiredEnergy: EnergyLevel.Reflective,
};

const cards = [
  { id: "c1", kind: "fact", content: "Scrubbers remove CO2 from cabin air." } as any,
];

/** Scripts TypeSafe's answers: the Choice picks `problem`; card c1 is introduced. */
function scriptVerdict(problem = "no_problem") {
  judgeMock.mockImplementationOnce(async (_state, questions) => ({
    status: "ok",
    answers: Object.fromEntries(
      Object.keys(questions).map((id) => [
        id,
        id === "most_serious_problem"
          ? { type: "choice", choice: problem, probabilities: {}, confidence: 0.9 }
          : { type: "noul", probability: 0.9 },
      ])
    ),
  }));
}

describe("TurnReviewerAgent with turn-review=on", () => {
  it("accepts via TypeSafe, skips the Premium review, and extracts terms on Economy", async () => {
    scriptVerdict();
    const agent = new TurnReviewerAgent();
    const call = vi
      .spyOn(agent as any, "callModelForStructuredOutput")
      .mockResolvedValue({
        introducedTerms: [
          { term: "CO2 scrubber", plainLanguageMeaning: "a cabin air filter for CO2" },
        ],
      });

    const result = await agent.review(speech, brief, cards, []);

    expect(result.accepted).toBe(true);
    expect(result.advancesBeat).toBe(true);
    expect(result.introducedCardIds).toEqual(["c1"]);
    expect(result.introducedTerms).toEqual([
      { term: "CO2 scrubber", plainLanguageMeaning: "a cabin air filter for CO2" },
    ]);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][0]).toBe(ModelTask.TermExtraction);
  });

  it("rejects via TypeSafe and rewrites using the chosen reason's feedback", async () => {
    scriptVerdict("repeats_earlier_content");
    const agent = new TurnReviewerAgent();
    const call = vi
      .spyOn(agent as any, "callModelForStructuredOutput")
      .mockResolvedValue({ message: "A fresh angle on the scrubber." });

    const result = await agent.review(speech, brief, cards, []);

    expect(result.accepted).toBe(false);
    expect(result.addsVariety).toBe(false);
    expect(result.feedback).toBe(TURN_REJECTION_REASONS.repeats_earlier_content.feedback);
    expect(result.revisedMessage).toBe("A fresh angle on the scrubber.");
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][0]).toBe(ModelTask.TurnReview);
    const rewritePrompt = (call.mock.calls[0][1] as any)[0].content as string;
    expect(rewritePrompt).toContain("Rewrite this rejected podcast turn");
    expect(rewritePrompt).toContain(TURN_REJECTION_REASONS.repeats_earlier_content.feedback);
  });

  it("accepts and extracts terms when the provider is unavailable", async () => {
    judgeMock.mockResolvedValueOnce({ status: "unavailable", reason: "HTTP 529" });
    const agent = new TurnReviewerAgent();
    const call = vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValue({ introducedTerms: [] });
    const result = await agent.review(speech, brief, cards, []);
    expect(result.accepted).toBe(true);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][0]).toBe(ModelTask.TermExtraction);
  });
});
