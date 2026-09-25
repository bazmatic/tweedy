import { describe, expect, it, vi } from "vitest";
import {
  scoreStoryValues,
  scoreStoryValuesWithTypeSafe,
  toStoryValue,
} from "./TypeSafeStoryValueJudge";
import { IJudgmentProvider, JudgmentQuestions } from "../providers/judgment-questions";
import { JudgmentRunner } from "../services/JudgmentRunner";
import { IJudgmentLog, JudgmentRecord } from "../services/JudgmentLog";
import { parseJudgmentModes } from "../services/judgment-modes";

function positions(values: number[]) {
  const judge = vi.fn(async (_state: unknown, questions: JudgmentQuestions) => ({
    status: "ok" as const,
    answers: Object.fromEntries(
      Object.keys(questions).map((id, index) => [
        id,
        { type: "score", score: values[index], confidence: 0.8 },
      ])
    ),
  }));
  return { judge } as unknown as IJudgmentProvider & { judge: typeof judge };
}

const cards = [
  { id: "stat", content: "The mission lasted 5 days, 22 hours and 54 minutes." },
  { id: "hook", content: "The crew built a CO2 adaptor from socks and duct tape." },
];
const request = { podcastTitle: "Apollo 13", cards, current: async () => ({ stat: 3, hook: 9 }) };

describe("toStoryValue", () => {
  it("maps the four levels onto 1-10", () => {
    expect(toStoryValue(0)).toBe(1);
    expect(toStoryValue(1)).toBe(4);
    expect(toStoryValue(2)).toBe(7);
    expect(toStoryValue(3)).toBe(10);
    expect(toStoryValue(1.5)).toBe(6);
  });
});

describe("scoreStoryValuesWithTypeSafe", () => {
  it("asks one Score per card over the cards as state", async () => {
    const provider = positions([0.2, 2.8]);

    const decision = await scoreStoryValuesWithTypeSafe(request, provider);

    expect(decision).toMatchObject({ status: "ok", value: { stat: 2, hook: 9 } });
    const [state, questions] = provider.judge.mock.calls[0];
    expect(state).toEqual({ podcast_title: "Apollo 13", cards: cards.map((c) => c.content) });
    expect(Object.keys(questions)).toEqual(["story_value_of_card_0", "story_value_of_card_1"]);
    expect(questions.story_value_of_card_0.type).toBe("score");
  });

  it("does not call the provider for no cards", async () => {
    const provider = positions([]);
    expect(await scoreStoryValuesWithTypeSafe({ ...request, cards: [] }, provider)).toEqual({
      status: "ok",
      value: {},
    });
    expect(provider.judge).not.toHaveBeenCalled();
  });
});

describe("scoreStoryValues", () => {
  it("shadow: keeps the extraction scores and agrees within two points", async () => {
    const records: JudgmentRecord[] = [];
    const log: IJudgmentLog = { append: async (r) => void records.push(r), readAll: async () => records };
    const runner = new JudgmentRunner(parseJudgmentModes("card-story-value=shadow"), log);

    const close = await scoreStoryValues(request, { runner, provider: positions([0.5, 2.5]) });
    await scoreStoryValues(request, { runner, provider: positions([2.5, 2.5]) });

    expect(close).toEqual({ stat: 3, hook: 9 });
    expect(records.map((r) => r.agreed)).toEqual([true, false]);
  });
});
