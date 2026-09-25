import { Speech } from "../types";
import { choice, IJudgmentProvider } from "../providers/judgment-questions";
import { JudgmentRunner, TypeSafeDecision } from "../services/JudgmentRunner";
import {
  getJudgmentProvider,
  getJudgmentRunner,
} from "../services/judgment-runtime";
// Type-only: ResponseModePolicy imports this module, so a runtime import of
// its enum would be circular. The literals below are the enum's values.
import type { ConversationalObligation } from "./ResponseModePolicy";

export const RESPONSE_OBLIGATION_JUDGMENT = "response-obligation";

/**
 * What the next speaker owes the previous turn, when no structural protocol
 * (tease → invite → elaborate, or an explicit challenge tool) already
 * decides it. Keys are the Choice options the model sees.
 */
const OBLIGATIONS = {
  answer_the_question_just_asked: {
    obligation: "answer_question" as ConversationalObligation,
    criterion:
      "`previous_turn` asks a genuine question or makes a request for information or explanation — with or without a question mark — that `next_speaker` should now answer",
  },
  respond_to_the_pushback: {
    obligation: "answer_challenge" as ConversationalObligation,
    criterion:
      "`previous_turn` disputes, doubts, or pushes back on something said earlier, so `next_speaker` should now defend the point, concede, or answer the objection",
  },
  no_pending_obligation: {
    obligation: "execute_brief" as ConversationalObligation,
    criterion:
      "`previous_turn` leaves nothing that demands a direct reply — it makes a statement, or asks only a rhetorical question that it answers itself or that needs no answer — so `next_speaker` can carry on with their own point",
  },
} as const;

type ObligationOption = keyof typeof OBLIGATIONS;

export interface ObligationRequest {
  /** The last spoken turns, oldest first; at least one. */
  recentSpeeches: Speech[];
  nextSpeakerName: string;
  /** Today's rule: the question tool or a trailing "?". */
  current: () => Promise<ConversationalObligation>;
}

export interface ObligationJudgeDeps {
  runner?: JudgmentRunner;
  provider?: IJudgmentProvider;
}

/** Decides the next speaker's obligation through the `response-obligation` judgment. */
export function judgeResponseObligation(
  request: ObligationRequest,
  deps: ObligationJudgeDeps = {}
): Promise<ConversationalObligation> {
  const runner = deps.runner ?? getJudgmentRunner();
  return runner.run({
    judgment: RESPONSE_OBLIGATION_JUDGMENT,
    current: request.current,
    typesafe: () =>
      judgeResponseObligationWithTypeSafe(
        request,
        deps.provider ?? getJudgmentProvider()
      ),
    state: toState(request),
  });
}

export async function judgeResponseObligationWithTypeSafe(
  request: ObligationRequest,
  provider: IJudgmentProvider
): Promise<TypeSafeDecision<ConversationalObligation>> {
  const result = await provider.judge(toState(request), {
    reply_owed_to_previous_turn: choice(
      "In this podcast conversation, what does `next_speaker` owe `previous_turn` in their reply?",
      Object.fromEntries(
        Object.entries(OBLIGATIONS).map(([option, { criterion }]) => [
          option,
          criterion,
        ])
      ) as Record<ObligationOption, string>
    ),
  });
  if (result.status !== "ok") return result;

  const answer = result.answers.reply_owed_to_previous_turn;
  return {
    status: "ok",
    value: OBLIGATIONS[answer.choice].obligation,
    detail: {
      choice: answer.choice,
      confidence: answer.confidence,
      probabilities: answer.probabilities,
    },
  };
}

function toState(request: ObligationRequest) {
  const [previous, beforePrevious] = [...request.recentSpeeches].reverse();
  const line = (speech: Speech) => `${speech.speaker.name}: ${speech.message}`;
  return {
    ...(beforePrevious ? { turn_before_previous: line(beforePrevious) } : {}),
    previous_turn: line(previous),
    next_speaker: request.nextSpeakerName,
  };
}
