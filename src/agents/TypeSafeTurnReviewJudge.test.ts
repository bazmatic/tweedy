import { describe, expect, it, vi } from "vitest";
import {
  applicableReasons,
  isTurnAccepted,
  judgeTurnReviewWithTypeSafe,
  reviewTurn,
  TURN_REJECTION_REASONS,
  TurnReviewRequest,
  TurnReviewVerdict,
} from "./TypeSafeTurnReviewJudge";
import {
  IJudgmentProvider,
  JudgmentQuestions,
} from "../providers/judgment-questions";
import { JudgmentRunner } from "../services/JudgmentRunner";
import { IJudgmentLog, JudgmentRecord } from "../services/JudgmentLog";
import { parseJudgmentModes } from "../services/judgment-modes";
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
 * Answers every question: the named problems get the given probabilities,
 * every other problem 0.05, the goal question `advances`, and each
 * `introduces_card_<id>` question its entry in `cards` (default 0).
 */
const verdict = (
  problems: Record<string, number>,
  advances = 0.8,
  cards: Record<string, number> = {}
) =>
  fakeProvider((questions) =>
    Object.fromEntries(
      Object.keys(questions).map((id) => {
        const probability =
          id === "advances_turn_goal"
            ? advances
            : id.startsWith("introduces_card_")
              ? cards[id.slice("introduces_card_".length)] ?? 0
              : problems[id] ?? 0.05;
        return [id, { type: "noul", probability }];
      })
    )
  );

const currentVerdict: TurnReviewVerdict = {
  accepted: true,
  clear: true,
  engaging: true,
  grounded: true,
  advancesBeat: true,
  addsVariety: true,
  roleConsistent: true,
  knowledgeConsistent: true,
  audienceAccessible: true,
  castConsistent: true,
  introducedCardIds: [],
  introducedTerms: [],
  feedback: "",
};

const request = (overrides: Partial<TurnReviewRequest> = {}): TurnReviewRequest => ({
  reviewBrief: "Review this podcast turn against its assigned editorial purpose. Goal: explain the fix.",
  candidateTurn: "They taped a square filter into a round socket.",
  assignedCards: [
    { id: "c1", content: "The crew adapted square CO2 filters to round sockets." },
    { id: "c2", content: "Mission control improvised the procedure overnight." },
  ],
  saidSoFar: ["HOST: The oxygen tank exploded two days out."],
  current: async () => currentVerdict,
  ...overrides,
});

function memoryRunner(modes: string) {
  const records: JudgmentRecord[] = [];
  const log: IJudgmentLog = {
    append: async (r) => void records.push(r),
    readAll: async () => records,
  };
  return { records, runner: new JudgmentRunner(parseJudgmentModes(modes), log) };
}

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
  it("accepts when no problem reaches the threshold, and maps goal and card probabilities", async () => {
    const provider = verdict({ repeats_earlier_content: 0.49 }, 0.7, { c1: 0.9, c2: 0.2 });

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

  it("asks one descriptively named yes/no per applicable problem and per card", async () => {
    const provider = verdict({});

    await judgeTurnReviewWithTypeSafe(request(), provider, 0.5);

    const [state, questions] = provider.judge.mock.calls[0];
    expect(state).toEqual({
      review_brief: request().reviewBrief,
      said_so_far: request().saidSoFar,
      candidate_turn: request().candidateTurn,
    });
    const ids = Object.keys(questions);
    expect(ids).toContain("advances_turn_goal");
    expect(ids).toContain("repeats_earlier_content");
    expect(ids).toContain("introduces_card_c1");
    expect(ids).toContain("introduces_card_c2");
    expect(ids).not.toContain("no_problem");
    expect(ids).not.toContain("closing_lacks_farewell");
    expect(Object.values(questions).every((q) => q.type === "noul")).toBe(true);
    expect(questions.introduces_card_c1.instructions).toContain("square CO2 filters");
    expect(questions.repeats_earlier_content.instructions).toContain("`said_so_far`");
  });

  it("asks closing-only problems for a closing statement", async () => {
    const provider = verdict({});

    await judgeTurnReviewWithTypeSafe(
      request({ tool: SpeakerAgentToolName.CLOSING_STATEMENT }),
      provider,
      0.5
    );

    expect(Object.keys(provider.judge.mock.calls[0][1])).toContain(
      "closing_lacks_farewell"
    );
  });

  it("names the most probable problem and fails every flag above the threshold", async () => {
    const decision = await judgeTurnReviewWithTypeSafe(
      request(),
      verdict({ addresses_someone_not_in_cast: 0.92, breaks_speaker_role: 0.6 }),
      0.5
    );

    if (decision.status !== "ok") throw new Error("expected ok");
    expect(decision.detail).toMatchObject({ reason: "addresses_someone_not_in_cast" });
    expect(decision.value.feedback).toBe(
      TURN_REJECTION_REASONS.addresses_someone_not_in_cast.feedback
    );
    expect(decision.value.castConsistent).toBe(false);
    expect(decision.value.roleConsistent).toBe(false);
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
      verdict({ [reason]: 0.9 }),
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
      verdict({ ignores_preceding_exchange: 0.9 }),
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
  it("shadow: acts on the current review and compares acceptance only", async () => {
    const { runner, records } = memoryRunner("turn-review=shadow");

    const result = await reviewTurn(request(), {
      runner,
      provider: verdict({}, 0.1, { c1: 0.9, c2: 0.9 }),
    });

    expect(result).toBe(currentVerdict);
    // Different beat/card judgments, same accept decision → agreement.
    expect(records[0]).toMatchObject({
      judgment: "turn-review",
      agreed: true,
      typesafeDetail: { reason: "no_problem" },
    });
  });

  it("shadow: a TypeSafe rejection of an accepted turn is a disagreement", async () => {
    const { runner, records } = memoryRunner("turn-review=shadow");

    await reviewTurn(request(), {
      runner,
      provider: verdict({ repeats_earlier_content: 0.94 }),
    });

    expect(records[0].agreed).toBe(false);
  });
});
