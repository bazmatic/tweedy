import { EditorialMove, Speech } from "../types";
import { judgeRhythm } from "./TypeSafeRhythmJudge";

export interface RhythmRecommendation {
  preferredMoves: EditorialMove[];
  avoidedMoves: EditorialMove[];
  reason: string;
}

export const RECENT_TURNS_ALL_BRIEF_REACTIONS: RhythmRecommendation = {
  preferredMoves: [
    EditorialMove.Explain,
    EditorialMove.TellStory,
    EditorialMove.Illustrate,
  ],
  avoidedMoves: [EditorialMove.React, EditorialMove.Question],
  reason:
    "Recent turns were all brief reactions; the next turn should add substance.",
};

export const RECENT_TURNS_INFORMATION_HEAVY: RhythmRecommendation = {
  preferredMoves: [EditorialMove.React, EditorialMove.Question],
  avoidedMoves: [
    EditorialMove.Explain,
    EditorialMove.AddContext,
    EditorialMove.Reframe,
  ],
  reason:
    "Recent turns were information-heavy; vary the rhythm with a reaction or question rather than reframing, since this heuristic has no way to tell whether the current subject has actually been discussed before.",
};

/**
 * Cheap variety guidance, judged from what recent turns actually said. The
 * LLM remains free to make the editorial choice, but it is told when the
 * recent rhythm has become repetitive.
 */
export class ConversationRhythmPolicy {
  recommend(speeches: Speech[]): Promise<RhythmRecommendation | undefined> {
    const recent = speeches.slice(-3);
    if (recent.length < 2) return Promise.resolve(undefined);
    return judgeRhythm({ recentSpeeches: recent });
  }
}
