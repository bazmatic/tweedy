import { EditorialMove, Speech } from "../types";
import { SpeakerAgentToolName } from "./speaker-tools";

export interface RhythmRecommendation {
  preferredMoves: EditorialMove[];
  avoidedMoves: EditorialMove[];
  reason: string;
}

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
      return {
        preferredMoves: [
          EditorialMove.Explain,
          EditorialMove.TellStory,
          EditorialMove.Illustrate,
        ],
        avoidedMoves: [EditorialMove.React, EditorialMove.Question],
        reason:
          "Recent turns were all brief reactions; the next turn should add substance.",
      };
    }

    const substantiveRun = recent.filter(
      (speech) => speech.tool === SpeakerAgentToolName.SPEAK
    ).length;
    if (substantiveRun >= 2) {
      return {
        preferredMoves: [
          EditorialMove.React,
          EditorialMove.Question,
          EditorialMove.Reframe,
        ],
        avoidedMoves: [EditorialMove.Explain, EditorialMove.AddContext],
        reason:
          "Recent turns were information-heavy; vary the rhythm with a reaction, question or reframe.",
      };
    }

    return undefined;
  }
}
