import { describe, expect, it, vi } from "vitest";
import {
  judgeResponseObligation,
  judgeResponseObligationWithTypeSafe,
} from "./TypeSafeObligationJudge";
import { ConversationalObligation } from "./ResponseModePolicy";
import { IJudgmentProvider } from "../providers/judgment-questions";
import { JudgmentRunner } from "../services/JudgmentRunner";
import { IJudgmentLog, JudgmentRecord } from "../services/JudgmentLog";
import { parseJudgmentModes } from "../services/judgment-modes";
import { Speech } from "../types";

const said = (name: string, message: string) =>
  ({ speaker: { id: name, name }, message }) as unknown as Speech;

function choosing(option: string) {
  const judge = vi.fn(async () => ({
    status: "ok" as const,
    answers: {
      reply_owed_to_previous_turn: {
        type: "choice" as const,
        choice: option,
        probabilities: { [option]: 0.9 },
        confidence: 0.8,
      },
    },
  }));
  return { judge } as unknown as IJudgmentProvider & { judge: typeof judge };
}

function memoryRunner(modes: string) {
  const records: JudgmentRecord[] = [];
  const log: IJudgmentLog = {
    append: async (r) => void records.push(r),
    readAll: async () => records,
  };
  return { records, runner: new JudgmentRunner(parseJudgmentModes(modes), log) };
}

const request = {
  recentSpeeches: [
    said("Ada", "The oxygen tank exploded two days out."),
    said("Ben", "Tell me how they kept breathing after that"),
  ],
  nextSpeakerName: "Ada",
  current: async () => ConversationalObligation.ExecuteBrief,
};

describe("judgeResponseObligationWithTypeSafe", () => {
  it.each([
    ["answer_the_question_just_asked", ConversationalObligation.AnswerQuestion],
    ["respond_to_the_pushback", ConversationalObligation.AnswerChallenge],
    ["no_pending_obligation", ConversationalObligation.ExecuteBrief],
  ])("maps %s to the policy's obligation", async (option, obligation) => {
    const decision = await judgeResponseObligationWithTypeSafe(
      request,
      choosing(option)
    );

    expect(decision).toMatchObject({ status: "ok", value: obligation });
  });

  it("sends the last two turns and the next speaker as named state", async () => {
    const provider = choosing("no_pending_obligation");

    await judgeResponseObligationWithTypeSafe(request, provider);

    const [state, questions] = provider.judge.mock.calls[0] as unknown as [
      unknown,
      Record<string, { type: string; criteria: Record<string, string> }>,
    ];
    expect(state).toEqual({
      turn_before_previous: "Ada: The oxygen tank exploded two days out.",
      previous_turn: "Ben: Tell me how they kept breathing after that",
      next_speaker: "Ada",
    });
    expect(questions.reply_owed_to_previous_turn.type).toBe("choice");
    expect(Object.keys(questions.reply_owed_to_previous_turn.criteria)).toEqual([
      "answer_the_question_just_asked",
      "respond_to_the_pushback",
      "no_pending_obligation",
    ]);
  });

  it("omits turn_before_previous when only one turn exists", async () => {
    const provider = choosing("no_pending_obligation");

    await judgeResponseObligationWithTypeSafe(
      { ...request, recentSpeeches: [request.recentSpeeches[1]] },
      provider
    );

    expect((provider.judge.mock.calls[0] as unknown[])[0]).toEqual({
      previous_turn: "Ben: Tell me how they kept breathing after that",
      next_speaker: "Ada",
    });
  });
});

describe("judgeResponseObligation", () => {
  it("shadow: acts on the rule and logs the TypeSafe choice", async () => {
    const { runner, records } = memoryRunner("response-obligation=shadow");

    const obligation = await judgeResponseObligation(request, {
      runner,
      provider: choosing("answer_the_question_just_asked"),
    });

    expect(obligation).toBe(ConversationalObligation.ExecuteBrief);
    expect(records[0]).toMatchObject({
      judgment: "response-obligation",
      current: ConversationalObligation.ExecuteBrief,
      typesafe: ConversationalObligation.AnswerQuestion,
      agreed: false,
      typesafeDetail: { choice: "answer_the_question_just_asked" },
    });
  });
});
