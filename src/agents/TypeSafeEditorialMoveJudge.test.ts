import { describe, expect, it, vi } from "vitest";
import {
  chooseEditorialMove,
  chooseEditorialMoveWithTypeSafe,
} from "./TypeSafeEditorialMoveJudge";
import { IJudgmentProvider } from "../providers/judgment-questions";
import { JudgmentRunner } from "../services/JudgmentRunner";
import { IJudgmentLog, JudgmentRecord } from "../services/JudgmentLog";
import { parseJudgmentModes } from "../services/judgment-modes";
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
  current: async () => EditorialMove.Explain,
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
  it("shadow: keeps the director's move and logs the comparison", async () => {
    const records: JudgmentRecord[] = [];
    const log: IJudgmentLog = { append: async (r) => void records.push(r), readAll: async () => records };
    const runner = new JudgmentRunner(parseJudgmentModes("editorial-move=shadow"), log);

    const move = await chooseEditorialMove(request, { runner, provider: choosing(EditorialMove.Question) });

    expect(move).toBe(EditorialMove.Explain);
    expect(records[0]).toMatchObject({
      judgment: "editorial-move",
      current: EditorialMove.Explain,
      typesafe: EditorialMove.Question,
      agreed: false,
    });
  });

  it("on: uses the judged move", async () => {
    const runner = new JudgmentRunner(parseJudgmentModes("editorial-move=on"), {
      append: async () => {},
      readAll: async () => [],
    });

    expect(await chooseEditorialMove(request, { runner, provider: choosing(EditorialMove.Question) })).toBe(
      EditorialMove.Question
    );
  });
});
