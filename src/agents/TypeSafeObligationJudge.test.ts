import { describe, expect, it, vi } from "vitest";
import {
  judgeResponseObligation,
  judgeResponseObligationWithTypeSafe,
} from "./TypeSafeObligationJudge";
import { ConversationalObligation } from "./ResponseModePolicy";
import { IJudgmentProvider } from "../providers/judgment-questions";
import { Speech } from "../types";
import { setJudgmentProvider } from "../services/judgment-runtime";
import { unavailableProvider } from "../test-support/judgments";

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

const request = {
  recentSpeeches: [
    said("Ada", "The oxygen tank exploded two days out."),
    said("Ben", "Tell me how they kept breathing after that"),
  ],
  nextSpeakerName: "Ada",
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
  it("returns the provider's obligation", async () => {
    setJudgmentProvider(choosing("respond_to_the_pushback"));
    expect(await judgeResponseObligation(request)).toBe(
      ConversationalObligation.AnswerChallenge
    );
  });

  it("returns ExecuteBrief when the provider is unavailable", async () => {
    setJudgmentProvider(unavailableProvider());
    expect(await judgeResponseObligation(request)).toBe(
      ConversationalObligation.ExecuteBrief
    );
  });
});
