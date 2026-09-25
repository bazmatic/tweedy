import { EditorialMove, Speech } from "../types";
import { SpeakerAgentToolName } from "./speaker-tools";
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
 * Cheap, deterministic variety guidance. The LLM remains free to make the
 * editorial choice, but it is told when the recent rhythm has become repetitive.
 */
export class ConversationRhythmPolicy {
  recommend(speeches: Speech[]): RhythmRecommendation | undefined {
    const recent = speeches.slice(-3);
    if (recent.length < 2) return undefined;

    const reactionTools = new Set<SpeakerAgentToolName>([
      SpeakerAgentToolName.INTERJECT,
      SpeakerAgentToolName.FILLER_COMMENT,
      SpeakerAgentToolName.ONE_LINER,
      SpeakerAgentToolName.SHORT_QUESTION,
    ]);
    if (recent.every((speech) => speech.tool && reactionTools.has(speech.tool))) {
      return RECENT_TURNS_ALL_BRIEF_REACTIONS;
    }

    const substantiveRun = recent.filter(
      (speech) => speech.tool === SpeakerAgentToolName.SPEAK
    ).length;
    if (substantiveRun >= 2) {
      return RECENT_TURNS_INFORMATION_HEAVY;
    }

    return undefined;
  }

  /**
   * recommend() routed through the `conversation-rhythm` judgment, which
   * reads what the recent turns actually said rather than which tool
   * delivered them (a long one-liner is not a brief reaction).
   */
  recommendJudged(speeches: Speech[]): Promise<RhythmRecommendation | undefined> {
    if (speeches.slice(-3).length < 2) return Promise.resolve(undefined);
    return judgeRhythm({
      recentSpeeches: speeches.slice(-3),
      current: async () => this.recommend(speeches),
    });
  }
}
