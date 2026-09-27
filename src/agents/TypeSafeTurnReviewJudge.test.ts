import { describe, expect, it, vi } from "vitest";
import {
  applicableReasons,
  isTurnAccepted,
  judgeTurnReviewWithTypeSafe,
  reviewTurn,
  TURN_REJECTION_REASONS,
  TurnReviewRequest,
} from "./TypeSafeTurnReviewJudge";
import {
  IJudgmentProvider,
  JudgmentQuestions,
} from "../providers/judgment-questions";
import { setJudgmentProvider } from "../services/judgment-runtime";
import { scriptedProvider, unavailableProvider } from "../test-support/judgments";
import { SpeakerAgentToolName } from "./speaker-tools";

type Answers = Record<string, unknown>;

function fakeProvider(answers: (questions: JudgmentQuestions) => Answers) {
  const judge = vi.fn(async (_state: unknown, questions: JudgmentQuestions) => ({
    status: "ok" as const,
    answers: answers(questions),
  }));
  return { judge } as unknown as IJudgmentProvider & { judge: typeof judge };
}

/**
 * Answers every question: `most_serious_problem` chooses `reason`, the goal
 * question gets `advances`, and each `introduces_card_<id>` question its
 * entry in `cards` (default 0).
 */
const verdict = (
  reason: string,
  advances = 0.8,
  cards: Record<string, number> = {}
) =>
  fakeProvider((questions) =>
    Object.fromEntries(
      Object.keys(questions).map((id) => [
        id,
        id === "most_serious_problem"
          ? {
              type: "choice",
              choice: reason,
              probabilities: { [reason]: 0.9 },
              confidence: 0.85,
            }
          : {
              type: "noul",
              probability:
                id === "advances_turn_goal"
                  ? advances
                  : cards[id.slice("introduces_card_".length)] ?? 0,
            },
      ])
    )
  );

const request = (overrides: Partial<TurnReviewRequest> = {}): TurnReviewRequest => ({
  reviewBrief: "Review this podcast turn against its assigned editorial purpose. Goal: explain the fix.",
  candidateTurn: "They taped a square filter into a round socket.",
  assignedCards: [
    { id: "c1", content: "The crew adapted square CO2 filters to round sockets." },
    { id: "c2", content: "Mission control improvised the procedure overnight." },
  ],
  saidSoFar: ["HOST: The oxygen tank exploded two days out."],
  ...overrides,
});

describe("applicableReasons", () => {
  it("offers tool-specific reasons only for that tool", () => {
    const general = applicableReasons(SpeakerAgentToolName.SPEAK);
    expect(general).toContain("no_problem");
    expect(general).toContain("repeats_earlier_content");
    expect(general).not.toContain("closing_lacks_farewell");
    expect(general).not.toContain("leaves_pending_question_unanswered");

    expect(applicableReasons(SpeakerAgentToolName.CLOSING_STATEMENT)).toContain(
      "closing_lacks_farewell"
    );
    expect(applicableReasons(SpeakerAgentToolName.NEARLY_OUT_OF_TIME)).toContain(
      "leaves_pending_question_unanswered"
    );
  });
});

describe("judgeTurnReviewWithTypeSafe", () => {
  it("accepts on no_problem and maps goal and card probabilities", async () => {
    const provider = verdict("no_problem", 0.7, { c1: 0.9, c2: 0.2 });

    const decision = await judgeTurnReviewWithTypeSafe(request(), provider, 0.5);

    expect(decision.status).toBe("ok");
    if (decision.status !== "ok") return;
    expect(isTurnAccepted(decision.value)).toBe(true);
    expect(decision.value).toMatchObject({
      advancesBeat: true,
      introducedCardIds: ["c1"],
      feedback: "",
    });
    expect(decision.value.introducedTerms).toBeUndefined();
    expect(decision.detail).toMatchObject({
      reason: "no_problem",
      cards: { c1: 0.9, c2: 0.2 },
    });
  });

  it("asks one Choice over applicable problems plus a yes/no per card", async () => {
    const provider = verdict("no_problem");

    await judgeTurnReviewWithTypeSafe(request(), provider, 0.5);

    const [state, questions] = provider.judge.mock.calls[0];
    expect(state).toEqual({
      review_brief: request().reviewBrief,
      said_so_far: request().saidSoFar,
      candidate_turn: request().candidateTurn,
    });
    expect(Object.keys(questions).sort()).toEqual(
      [
        "advances_turn_goal",
        "introduces_card_c1",
        "introduces_card_c2",
        "most_serious_problem",
      ].sort()
    );
    const options = (questions.most_serious_problem as any).criteria;
    expect(Object.keys(options)).toContain("no_problem");
    expect(Object.keys(options)).toContain("repeats_earlier_content");
    expect(Object.keys(options)).not.toContain("closing_lacks_farewell");
    expect(options.repeats_earlier_content).toContain("`said_so_far`");
    expect(questions.introduces_card_c1.instructions).toContain("square CO2 filters");
  });

  it("offers closing-only problems for a closing statement", async () => {
    const provider = verdict("no_problem");

    await judgeTurnReviewWithTypeSafe(
      request({ tool: SpeakerAgentToolName.CLOSING_STATEMENT }),
      provider,
      0.5
    );

    const questions = provider.judge.mock.calls[0][1] as any;
    expect(Object.keys(questions.most_serious_problem.criteria)).toContain(
      "closing_lacks_farewell"
    );
  });

  it("uses the chosen problem's feedback and records the distribution", async () => {
    const decision = await judgeTurnReviewWithTypeSafe(
      request(),
      verdict("addresses_someone_not_in_cast"),
      0.5
    );

    if (decision.status !== "ok") throw new Error("expected ok");
    expect(decision.value.feedback).toBe(
      TURN_REJECTION_REASONS.addresses_someone_not_in_cast.feedback
    );
    expect(decision.value.castConsistent).toBe(false);
    expect(decision.detail).toMatchObject({
      reason: "addresses_someone_not_in_cast",
      reasonConfidence: 0.85,
    });
  });

  it.each([
    ["repeats_earlier_content", "addsVariety"],
    ["breaks_speaker_role", "roleConsistent"],
    ["relies_on_unsaid_or_unknown", "knowledgeConsistent"],
    ["specialist_term_left_unexplained", "audienceAccessible"],
    ["addresses_someone_not_in_cast", "castConsistent"],
  ])("rejects on %s by failing %s", async (reason, flag) => {
    const decision = await judgeTurnReviewWithTypeSafe(
      request(),
      verdict(reason),
      0.5
    );

    if (decision.status !== "ok") throw new Error("expected ok");
    expect(isTurnAccepted(decision.value)).toBe(false);
    expect((decision.value as any)[flag]).toBe(false);
    expect(decision.value.feedback.length).toBeGreaterThan(0);
  });

  it("rejects on a problem that fails no flag (ignoring the preceding exchange)", async () => {
    const decision = await judgeTurnReviewWithTypeSafe(
      request(),
      verdict("ignores_preceding_exchange"),
      0.5
    );

    if (decision.status !== "ok") throw new Error("expected ok");
    expect(decision.value.accepted).toBe(false);
    expect(isTurnAccepted(decision.value)).toBe(false);
  });

  it("passes through an unavailable result", async () => {
    const provider: IJudgmentProvider = {
      judge: async () => ({ status: "unavailable", reason: "HTTP 529" }),
    };

    expect(await judgeTurnReviewWithTypeSafe(request(), provider, 0.5)).toEqual({
      status: "unavailable",
      reason: "HTTP 529",
    });
  });
});

describe("reviewTurn", () => {
  it("uses the provider's verdict", async () => {
    setJudgmentProvider(verdict("repeats_earlier_content"));
    const result = await reviewTurn(request());
    expect(isTurnAccepted(result)).toBe(false);
    expect(result.feedback).toBe(TURN_REJECTION_REASONS.repeats_earlier_content.feedback);
  });

  it("accepts the turn when the provider is unavailable", async () => {
    setJudgmentProvider(unavailableProvider());
    const result = await reviewTurn(request());
    expect(isTurnAccepted(result)).toBe(true);
    expect(result.introducedTerms).toBeUndefined();
  });
});
