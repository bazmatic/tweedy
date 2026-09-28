import { describe, expect, it, vi } from "vitest";
import {
  chooseEditorialMove,
  chooseEditorialMoveWithTypeSafe,
} from "./TypeSafeEditorialMoveJudge";
import { IJudgmentProvider } from "../providers/judgment-questions";
import { setJudgmentProvider } from "../services/judgment-runtime";
import { scriptedProvider, unavailableProvider } from "../test-support/judgments";
import { EditorialMove, Speech } from "../types";

const said = (name: string, message: string) =>
  ({ speaker: { name }, message }) as unknown as Speech;

function choosing(move: string) {
  const judge = vi.fn(async () => ({
    status: "ok" as const,
    answers: {
      editorial_move_for_next_turn: {
        type: "choice" as const,
        choice: move,
        probabilities: { [move]: 0.9 },
        confidence: 0.8,
      },
    },
  }));
  return { judge } as unknown as IJudgmentProvider & { judge: typeof judge };
}

const request = {
  recentSpeeches: [said("Ben", "Two days out, an oxygen tank exploded.")],
  nextSpeaker: { name: "Ada", personality: "curious host" },
  direction: "Ask what the crew did next.",
  rhythmGuidance: "Rhythm guidance: vary with a question.",
};

describe("chooseEditorialMoveWithTypeSafe", () => {
  it("offers every editorial move and sends named state", async () => {
    const provider = choosing(EditorialMove.Question);

    const decision = await chooseEditorialMoveWithTypeSafe(request, provider);

    expect(decision).toMatchObject({ status: "ok", value: EditorialMove.Question });
    const [state, questions] = provider.judge.mock.calls[0] as unknown as [
      unknown,
      Record<string, { criteria: Record<string, string> }>,
    ];
    expect(state).toEqual({
      recent_conversation: ["Ben: Two days out, an oxygen tank exploded."],
      next_speaker: { name: "Ada", personality: "curious host" },
      director_direction: "Ask what the crew did next.",
      rhythm_guidance: "Rhythm guidance: vary with a question.",
    });
    expect(Object.keys(questions.editorial_move_for_next_turn.criteria).sort()).toEqual(
      Object.values(EditorialMove).sort()
    );
  });
});

describe("chooseEditorialMove", () => {
  it("uses the judged move", async () => {
    const provider = choosing(EditorialMove.Question);

    expect(await chooseEditorialMove(request, { provider })).toBe(EditorialMove.Question);
  });

  it("falls back to Explain when the provider is unavailable", async () => {
    setJudgmentProvider(unavailableProvider());

    expect(await chooseEditorialMove(request)).toBe(EditorialMove.Explain);
  });

  it("falls back to Explain when the provider is unavailable (scripted, unrelated question)", async () => {
    setJudgmentProvider(scriptedProvider(() => undefined));

    expect(await chooseEditorialMove(request)).toBe(EditorialMove.Explain);
  });
});
