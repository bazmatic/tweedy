import { TurnReview } from "../types";
import {
  IJudgmentProvider,
  NoulQuestion,
  noul,
} from "../providers/judgment-questions";
import { JudgmentRunner, TypeSafeDecision } from "../services/JudgmentRunner";
import {
  getJudgmentProvider,
  getJudgmentRunner,
} from "../services/judgment-runtime";
import { SpeakerAgentToolName } from "./speaker-tools";

export const TURN_REVIEW_JUDGMENT = "turn-review";
export const DEFAULT_TURN_REVIEW_THRESHOLD = 0.5;

type ReviewFlag =
  | "clear"
  | "grounded"
  | "addsVariety"
  | "roleConsistent"
  | "knowledgeConsistent"
  | "audienceAccessible"
  | "castConsistent";

interface ReasonSpec {
  /** The problem, phrased so "does this apply?" is a clear yes/no. */
  criterion: string;
  /** Overrides the generic question when a narrower one judges better. */
  question?: string;
  /** Plain-sentence feedback handed to the rewrite and any re-review. */
  feedback: string;
  /** Review flags this reason fails, mirroring the LLM reviewer's fields. */
  fails: ReviewFlag[];
  /** Offered only for these turn tools; offered for every turn when omitted. */
  onlyFor?: SpeakerAgentToolName[];
}

/**
 * The fixed set of reasons a turn can be rejected for. Each reason is asked
 * as its own narrow yes/no question (a single Choice across every reason
 * under-weighted less salient problems such as repetition); the turn is
 * rejected for the most probable reason above the threshold, and that
 * reason's feedback drives the rewrite. `no_problem` is the accepted outcome.
 */
export const TURN_REJECTION_REASONS = {
  no_problem: {
    criterion:
      "No clearly present problem: the turn meets the review brief and should be accepted",
    feedback: "",
    fails: [],
  },
  reference_listener_cannot_resolve: {
    criterion:
      "A listener who heard only the conversation so far could not tell what the turn is about, resolve a necessary reference (pronoun, name, shorthand), or follow how it connects to the preceding exchange",
    feedback:
      "A listener cannot resolve what or who this turn refers to from what has been said aloud.",
    fails: ["clear", "audienceAccessible"],
  },
  internally_incoherent: {
    criterion:
      "The turn is internally incoherent on its own terms: a sentence does not parse or contradicts itself",
    feedback: "The turn does not make sense on its own terms.",
    fails: ["clear"],
  },
  specialist_term_left_unexplained: {
    criterion:
      "A specialist concept carries the argument but is neither explained plainly nor explicitly promised an explanation, and the turn is not merely asking about it",
    feedback:
      "A necessary specialist term is used without a plain-language explanation.",
    fails: ["audienceAccessible"],
  },
  unsupported_factual_claim: {
    criterion:
      "The turn states a substantive factual claim about the subject that is not supported by the prepared material or anything already said",
    feedback:
      "The turn states a factual claim not supported by the prepared material.",
    fails: ["grounded"],
  },
  repeats_earlier_content: {
    criterion:
      "The turn substantively repeats a fact, claim, comparison, or example already said by any speaker, without building on it or adding a new angle (reprising the cold open's hook is fine)",
    // Asked against the earlier lines as their own field: buried inside the
    // full review brief, clear repeats scored well under the threshold.
    question:
      "Does `candidate_turn` substantively repeat a fact, claim, comparison, or example already stated in `said_so_far` (by any speaker), even if reworded, without building on it or adding a new angle? Reprising the episode's opening hook is not repetition.",
    feedback: "The turn repeats something already said without adding to it.",
    fails: ["addsVariety"],
  },
  breaks_speaker_role: {
    criterion:
      "The turn breaks the speaker's epistemic role: an expert feigns ignorance or claims unsupported authorship, or an audience guide introduces unseen specialist facts",
    feedback: "The turn is inconsistent with this speaker's role and expertise.",
    fails: ["roleConsistent"],
  },
  relies_on_unsaid_or_unknown: {
    criterion:
      "The turn relies on something the speaker could not know, cites as already said something never said, reverses a stance without support, or claims an unanswered challenge was answered",
    feedback:
      "The turn relies on something never actually said or known at this point.",
    fails: ["knowledgeConsistent"],
  },
  addresses_someone_not_in_cast: {
    criterion:
      "The turn addresses, thanks, or refers by name to a person speaking on the episode who is not one of the episode's actual speakers",
    feedback: "The turn addresses someone who is not one of the episode's speakers.",
    fails: ["castConsistent"],
  },
  ignores_preceding_exchange: {
    criterion:
      "The turn ignores a brief interjection it should acknowledge, breaks time continuity, or fails an explicit request to read or quote material",
    feedback: "The turn breaks continuity with the immediately preceding exchange.",
    fails: [],
  },
  closing_lacks_farewell: {
    criterion:
      "This closing statement never addresses the listener directly or lacks an explicit farewell sign-off",
    feedback:
      "The closing statement needs to address listeners directly and sign off with a farewell.",
    fails: [],
    onlyFor: [SpeakerAgentToolName.CLOSING_STATEMENT],
  },
  closing_introduces_new_material: {
    criterion:
      "This closing statement introduces a new topic, fact, or unresolved question not raised earlier in the conversation",
    feedback: "The closing statement introduces new material instead of wrapping up.",
    fails: [],
    onlyFor: [SpeakerAgentToolName.CLOSING_STATEMENT],
  },
  closing_ends_on_open_question: {
    criterion:
      "This closing statement ends on a question left hanging rather than answered within the same turn",
    feedback: "The closing statement ends on an unanswered question.",
    fails: [],
    onlyFor: [SpeakerAgentToolName.CLOSING_STATEMENT],
  },
  leaves_pending_question_unanswered: {
    criterion:
      "The immediately preceding turn posed a genuine question or left a concrete thread open, and this nearly-out-of-time turn only announces time pressure without answering it",
    feedback:
      "The turn announces time pressure without answering the pending question.",
    fails: [],
    onlyFor: [SpeakerAgentToolName.NEARLY_OUT_OF_TIME],
  },
} satisfies Record<string, ReasonSpec>;

export type TurnRejectionReason = keyof typeof TURN_REJECTION_REASONS;

/** A review verdict. `introducedTerms` is undefined until terms are extracted. */
export type TurnReviewVerdict = TurnReview & { feedback: string };

export interface TurnReviewRequest {
  /** The full review prompt the LLM reviewer receives: the rubric and all context. */
  reviewBrief: string;
  /** Earlier lines by any speaker, as "Name: message", for the repetition check. */
  saidSoFar: string[];
  candidateTurn: string;
  tool?: SpeakerAgentToolName;
  assignedCards: { id: string; content: string }[];
  /** Today's LLM review, returning a verdict with terms and feedback. */
  current: () => Promise<TurnReviewVerdict>;
}

export interface TurnReviewJudgeDeps {
  runner?: JudgmentRunner;
  provider?: IJudgmentProvider;
  threshold?: number;
}

/** The reviewer's acceptance rule: accepted and no failing consistency flag. */
export function isTurnAccepted(review: TurnReview): boolean {
  return Boolean(
    review.accepted &&
      review.addsVariety &&
      review.roleConsistent &&
      review.knowledgeConsistent &&
      review.audienceAccessible &&
      review.castConsistent
  );
}

/** Reviews a candidate turn through the `turn-review` judgment's rollout mode. */
export function reviewTurn(
  request: TurnReviewRequest,
  deps: TurnReviewJudgeDeps = {}
): Promise<TurnReviewVerdict> {
  const runner = deps.runner ?? getJudgmentRunner();
  return runner.run({
    judgment: TURN_REVIEW_JUDGMENT,
    current: request.current,
    typesafe: () =>
      judgeTurnReviewWithTypeSafe(
        request,
        deps.provider ?? getJudgmentProvider(),
        deps.threshold ?? DEFAULT_TURN_REVIEW_THRESHOLD
      ),
    state: { candidateTurn: request.candidateTurn, tool: request.tool },
    agrees: (current, typesafe) =>
      isTurnAccepted(current) === isTurnAccepted(typesafe),
  });
}

export function applicableReasons(
  tool: SpeakerAgentToolName | undefined
): TurnRejectionReason[] {
  return (Object.keys(TURN_REJECTION_REASONS) as TurnRejectionReason[]).filter(
    (reason) => {
      const onlyFor = (TURN_REJECTION_REASONS[reason] as ReasonSpec).onlyFor;
      return !onlyFor || (tool !== undefined && onlyFor.includes(tool));
    }
  );
}

export async function judgeTurnReviewWithTypeSafe(
  request: TurnReviewRequest,
  provider: IJudgmentProvider,
  threshold: number
): Promise<TypeSafeDecision<TurnReviewVerdict>> {
  const problems = applicableReasons(request.tool).filter(
    (reason): reason is Exclude<TurnRejectionReason, "no_problem"> => reason !== "no_problem"
  );
  const questions: Record<string, NoulQuestion> = {
    advances_turn_goal: noul(
      "Does `candidate_turn` meaningfully advance the goal stated in `review_brief`, rather than stalling, " +
        "restating, or drifting away from it?"
    ),
  };
  for (const reason of problems) {
    const spec: ReasonSpec = TURN_REJECTION_REASONS[reason];
    questions[reason] = noul(
      spec.question ??
        "`review_brief` is the editorial rubric and context for a proposed podcast turn, `candidate_turn`, " +
          "which listeners have not heard yet. Following that rubric, does this problem clearly apply to " +
          `\`candidate_turn\`: ${spec.criterion}?`
    );
  }
  request.assignedCards.forEach((card, index) => {
    questions[`introduces_card_${card.id}`] = noul(
      `Does \`candidate_turn\` explicitly introduce aloud the substance of this prepared card: "${card.content}"?`
    );
  });

  const result = await provider.judge(
    {
      review_brief: request.reviewBrief,
      said_so_far: request.saidSoFar,
      candidate_turn: request.candidateTurn,
    },
    questions
  );
  if (result.status !== "ok") return result;

  const problemProbabilities: Record<string, number> = {};
  const failing: { reason: TurnRejectionReason; probability: number }[] = [];
  for (const reason of problems) {
    const probability = result.answers[reason].probability;
    problemProbabilities[reason] = probability;
    if (probability >= threshold) failing.push({ reason, probability });
  }
  failing.sort((a, b) => b.probability - a.probability);
  const reason: TurnRejectionReason = failing[0]?.reason ?? "no_problem";

  const cardProbabilities: Record<string, number> = {};
  const introducedCardIds: string[] = [];
  request.assignedCards.forEach((card, index) => {
    const probability = result.answers[`introduces_card_${card.id}`].probability;
    cardProbabilities[card.id] = probability;
    if (probability >= threshold) introducedCardIds.push(card.id);
  });

  // Every problem above the threshold fails its flags, not just the top one.
  const fails = new Set<ReviewFlag>(
    failing.flatMap(({ reason: r }) => (TURN_REJECTION_REASONS[r] as ReasonSpec).fails)
  );
  const advancesBeat = result.answers.advances_turn_goal.probability;
  const verdict: TurnReviewVerdict = {
    accepted: reason === "no_problem",
    clear: !fails.has("clear"),
    // Not judged separately; nothing downstream gates on it.
    engaging: true,
    grounded: !fails.has("grounded"),
    advancesBeat: advancesBeat >= threshold,
    addsVariety: !fails.has("addsVariety"),
    roleConsistent: !fails.has("roleConsistent"),
    knowledgeConsistent: !fails.has("knowledgeConsistent"),
    audienceAccessible: !fails.has("audienceAccessible"),
    castConsistent: !fails.has("castConsistent"),
    introducedCardIds,
    feedback: TURN_REJECTION_REASONS[reason].feedback,
  };

  return {
    status: "ok",
    value: verdict,
    detail: {
      reason,
      problems: problemProbabilities,
      advancesBeat,
      cards: cardProbabilities,
    },
  };
}
