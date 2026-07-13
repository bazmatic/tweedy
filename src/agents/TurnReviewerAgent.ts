import {
  EditorialCard,
  ITurnReviewer,
  LlmMessage,
  Speech,
  TurnBrief,
  TurnReview,
} from "../types";
import { BaseAgent } from "./BaseAgent";
import {
  ReviewTurnInput,
  toReviewTurnTool,
} from "./editorial-tools";

export class TurnReviewerAgent extends BaseAgent implements ITurnReviewer {
  async review(
    speech: Speech,
    brief: TurnBrief,
    cards: EditorialCard[],
    recentSpeeches: Speech[]
  ): Promise<TurnReview & { revisedMessage?: string }> {
    const relevantCards = cards
      .filter((card) => brief.cardIds.includes(card.id))
      .map((card) => `- ${card.kind}: ${card.content}`)
      .join("\n");
    const recentText = recentSpeeches
      .slice(-4)
      .map((item) => `${item.speaker.name}: ${item.message}`)
      .join("\n");

    const messages: LlmMessage[] = [
      {
        role: "user",
        content: `Review this podcast turn against its assigned editorial purpose.

Goal: ${brief.goal}
Editorial move: ${brief.move}
Primary audience value: ${brief.audienceValue}
Desired energy: ${brief.desiredEnergy}

Relevant prepared material:
${relevantCards || "(No specific cards assigned.)"}

Recent conversation:
${recentText || "(This is the first turn.)"}

${speech.speaker.name} said: "${speech.message}"

Judge the turn according to what it is trying to do. Do not demand analysis from a story, humour from an explanation, or insight from a brief reaction. It should fulfil the goal, be understandable, sound engaging and natural, remain grounded when it makes factual claims, advance the beat, and avoid needless repetition. Use Australian/British spelling in any revision. If rejected, provide focused feedback and a corrected version in the same speaker's voice.`,
      },
    ];

    return this.callModelForToolInput<ReviewTurnInput>(
      messages,
      [toReviewTurnTool()],
      400
    );
  }
}
