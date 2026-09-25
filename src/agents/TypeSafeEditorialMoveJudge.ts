import { EditorialMove, Speaker, Speech } from "../types";
import { choice, IJudgmentProvider } from "../providers/judgment-questions";
import { JudgmentRunner, TypeSafeDecision } from "../services/JudgmentRunner";
import {
  getJudgmentProvider,
  getJudgmentRunner,
} from "../services/judgment-runtime";

export const EDITORIAL_MOVE_JUDGMENT = "editorial-move";

/** What each move asks of the next turn; the enum values are the option names. */
const MOVE_CRITERIA: Record<EditorialMove, string> = {
  [EditorialMove.Explain]: "Explain how or why something works",
  [EditorialMove.Illustrate]: "Give a concrete example of a point already made",
  [EditorialMove.TellStory]: "Tell a short story or anecdote",
  [EditorialMove.AddContext]: "Add background that helps listeners place what was said",
  [EditorialMove.Compare]: "Compare this with something similar",
  [EditorialMove.Contrast]: "Contrast this with something different",
  [EditorialMove.Connect]: "Connect this point to an earlier one",
  [EditorialMove.Reframe]: "Put what was said in a new, simpler, or more familiar frame",
  [EditorialMove.Question]: "Ask a question that moves the discussion on",
  [EditorialMove.Challenge]: "Push back on or test a claim just made",
  [EditorialMove.React]: "Briefly react to what was just said",
  [EditorialMove.Humanise]: "Bring out the people or feelings behind the facts",
  [EditorialMove.FindMeaning]: "Draw out why this matters or what it means",
  [EditorialMove.Summarise]: "Recap several points covered so far",
  [EditorialMove.Transition]: "Move the conversation to the next topic",
  [EditorialMove.Tease]: "Hook an upcoming point without giving it away yet",
};

export interface EditorialMoveRequest {
  recentSpeeches: Speech[];
  nextSpeaker?: Pick<Speaker, "name" | "personality">;
  /** The director's generated direction for this turn. */
  direction: string;
  rhythmGuidance?: string;
  /** The move the director model proposed alongside its direction. */
  current: () => Promise<EditorialMove>;
}

/**
 * Chooses the turn's editorial move through the `editorial-move` judgment.
 * The direction stays generative; this only classifies which move the next
 * turn should make, which in turn drives the speaker's allowed tools.
 */
export function chooseEditorialMove(
  request: EditorialMoveRequest,
  deps: { runner?: JudgmentRunner; provider?: IJudgmentProvider } = {}
): Promise<EditorialMove> {
  const runner = deps.runner ?? getJudgmentRunner();
  return runner.run({
    judgment: EDITORIAL_MOVE_JUDGMENT,
    current: request.current,
    typesafe: () =>
      chooseEditorialMoveWithTypeSafe(request, deps.provider ?? getJudgmentProvider()),
    state: { direction: request.direction },
  });
}

export async function chooseEditorialMoveWithTypeSafe(
  request: EditorialMoveRequest,
  provider: IJudgmentProvider
): Promise<TypeSafeDecision<EditorialMove>> {
  const result = await provider.judge(
    {
      recent_conversation: request.recentSpeeches.map(
        (speech) => `${speech.speaker.name}: ${speech.message}`
      ),
      ...(request.nextSpeaker
        ? {
            next_speaker: {
              name: request.nextSpeaker.name,
              personality: request.nextSpeaker.personality,
            },
          }
        : {}),
      director_direction: request.direction,
      ...(request.rhythmGuidance ? { rhythm_guidance: request.rhythmGuidance } : {}),
    },
    {
      editorial_move_for_next_turn: choice(
        "Which editorial move should the next turn in this podcast make, given `recent_conversation`, " +
          "`director_direction`, and any `rhythm_guidance`?",
        MOVE_CRITERIA
      ),
    }
  );
  if (result.status !== "ok") return result;

  const answer = result.answers.editorial_move_for_next_turn;
  return {
    status: "ok",
    value: answer.choice,
    detail: { confidence: answer.confidence, probabilities: answer.probabilities },
  };
}
