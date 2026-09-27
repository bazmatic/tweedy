import { TurnReview } from "../types";
import {
  choice,
  IJudgmentProvider,
  JudgmentQuestion,
  noul,
} from "../providers/judgment-questions";
import { decide, JudgmentDecision } from "../services/decide";
import { getJudgmentProvider } from "../services/judgment-runtime";
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
  /** What this outcome means, as the Choice criterion the model sees. */
  criterion: string;
  /** Plain-sentence feedback handed to the rewrite and any re-review. */
  feedback: string;
  /** Review flags this reason fails, mirroring the LLM reviewer's fields. */
  fails: ReviewFlag[];
  /** Offered only for these turn tools; offered for every turn when omitted. */
  onlyFor?: SpeakerAgentToolName[];
}

/**
 * The fixed set of reasons a turn can be rejected for, asked as one Choice
 * (`most_serious_problem`); `no_problem` is the accepted outcome and the
 * chosen reason's feedback drives the rewrite. On 20 labelled turns a single
 * Choice matched separate per-reason yes/no questions (20/20 accept/reject,
 * 20/20 vs 19/20 reason) at the same latency, with one question instead of
 * a dozen. What mattered was giving repetition the earlier lines as their
 * own `said_so_far` field.
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
    // Points at `said_so_far` rather than the lines buried in the brief:
    // judged against the brief alone, a verbatim repeat scored only 0.28.
    criterion:
      "The turn substantively repeats a fact, claim, comparison, or example already stated in `said_so_far` by any speaker, even if reworded, without building on it or adding a new angle (reprising the episode's opening hook is fine)",
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
}

export interface TurnReviewJudgeDeps {
  provider?: IJudgmentProvider;
  threshold?: number;
}

/** Used when the provider cannot review: accept, as the reviewer always has on failure. */
export const ACCEPTED_FALLBACK_VERDICT: TurnReviewVerdict = {
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
  feedback: "",
};

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

/** Reviews a candidate turn through the `turn-review` judgment. */
export function reviewTurn(
  request: TurnReviewRequest,
  deps: TurnReviewJudgeDeps = {}
): Promise<TurnReviewVerdict> {
  return decide({
    judgment: TURN_REVIEW_JUDGMENT,
    ask: () =>
      judgeTurnReviewWithTypeSafe(
        request,
        deps.provider ?? getJudgmentProvider(),
        deps.threshold ?? DEFAULT_TURN_REVIEW_THRESHOLD
      ),
    fallback: { ...ACCEPTED_FALLBACK_VERDICT },
    state: { candidateTurn: request.candidateTurn, tool: request.tool },
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
): Promise<JudgmentDecision<TurnReviewVerdict>> {
  const reasons = applicableReasons(request.tool);
  const questions: Record<string, JudgmentQuestion> = {
    most_serious_problem: choice(
      "`review_brief` is the editorial rubric and context for a proposed podcast turn, `candidate_turn`, " +
        "which listeners have not heard yet; `said_so_far` lists the earlier lines. Following that rubric, " +
        "which single problem, if any, should cause the turn to be rejected before broadcast? Choose " +
        "no_problem unless a problem is clearly present; when several apply, choose the most serious.",
      Object.fromEntries(
        reasons.map((reason) => [reason, TURN_REJECTION_REASONS[reason].criterion])
      )
    ),
    advances_turn_goal: noul(
      "Does `candidate_turn` meaningfully advance the goal stated in `review_brief`, rather than stalling, " +
        "restating, or drifting away from it?"
    ),
  };
  for (const card of request.assignedCards) {
    questions[`introduces_card_${card.id}`] = noul(
      `Does \`candidate_turn\` explicitly introduce aloud the substance of this prepared card: "${card.content}"?`
    );
  }

  const result = await provider.judge(
    {
      review_brief: request.reviewBrief,
      said_so_far: request.saidSoFar,
      candidate_turn: request.candidateTurn,
    },
    questions
  );
  if (result.status !== "ok") return result;

  const problemAnswer = result.answers.most_serious_problem;
  const goalAnswer = result.answers.advances_turn_goal;
  if (problemAnswer.type !== "choice" || goalAnswer.type !== "noul") {
    return { status: "unavailable", reason: "unexpected answer types" };
  }
  const reason = problemAnswer.choice as TurnRejectionReason;
  const spec: ReasonSpec = TURN_REJECTION_REASONS[reason];

  const cardProbabilities: Record<string, number> = {};
  const introducedCardIds: string[] = [];
  for (const card of request.assignedCards) {
    const answer = result.answers[`introduces_card_${card.id}`];
    const probability = answer.type === "noul" ? answer.probability : 0;
    cardProbabilities[card.id] = probability;
    if (probability >= threshold) introducedCardIds.push(card.id);
  }

  const fails = new Set(spec.fails);
  const verdict: TurnReviewVerdict = {
    accepted: reason === "no_problem",
    clear: !fails.has("clear"),
    // Not judged separately; nothing downstream gates on it.
    engaging: true,
    grounded: !fails.has("grounded"),
    advancesBeat: goalAnswer.probability >= threshold,
    addsVariety: !fails.has("addsVariety"),
    roleConsistent: !fails.has("roleConsistent"),
    knowledgeConsistent: !fails.has("knowledgeConsistent"),
    audienceAccessible: !fails.has("audienceAccessible"),
    castConsistent: !fails.has("castConsistent"),
    introducedCardIds,
    feedback: spec.feedback,
  };

  return {
    status: "ok",
    value: verdict,
    detail: {
      reason,
      reasonConfidence: problemAnswer.confidence,
      reasonProbabilities: problemAnswer.probabilities,
      advancesTurnGoal: goalAnswer.probability,
      cards: cardProbabilities,
    },
  };
}
