import {
  EditorialCard,
  ITurnReviewer,
  KnowledgeLedger,
  LlmMessage,
  ReviewedTurn,
  Speech,
  TurnBrief,
} from "../types";
import { BaseAgent } from "./BaseAgent";
import {
  ReviewTurnInput,
  toReviewTurnTool,
} from "./editorial-tools";
import { SpeakerRoleProfileResolver } from "./SpeakerRoleProfileResolver";

const EMPTY_KNOWLEDGE_LEDGER: KnowledgeLedger = { introducedCards: [] };
const MAX_REVIEW_TOKENS = 700;

export class TurnReviewerAgent extends BaseAgent implements ITurnReviewer {
  constructor(
    private readonly roleProfileResolver = new SpeakerRoleProfileResolver()
  ) {
    super();
  }

  async review(
    speech: Speech,
    brief: TurnBrief,
    cards: EditorialCard[],
    recentSpeeches: Speech[],
    knowledgeLedger: KnowledgeLedger = EMPTY_KNOWLEDGE_LEDGER
  ): Promise<ReviewedTurn> {
    const roleProfile = this.roleProfileResolver.resolve(speech.speaker);
    const relevantCards = cards
      .filter((card) => brief.cardIds.includes(card.id))
      .map((card) => `- ${card.kind}: ${card.content}`)
      .join("\n");
    const introducedCardIds = new Set(
      knowledgeLedger.introducedCards.map((entry) => entry.cardId)
    );
    const knowledgeStatus = brief.cardIds
      .map(
        (cardId) =>
          `- ${cardId}: ${
            introducedCardIds.has(cardId) ? "introduced aloud" : "not yet introduced aloud"
          }`
      )
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
Speaker epistemic role: ${roleProfile.epistemicRole}
Speaker source access: ${roleProfile.sourceAccess}
Speaker uncertainty style: ${roleProfile.uncertaintyStyle}

Relevant prepared material:
${relevantCards || "(No specific cards assigned.)"}

Knowledge status:
${knowledgeStatus || "(No prepared cards assigned.)"}

Recent conversation:
${recentText || "(This is the first turn.)"}

${speech.speaker.name} said: "${speech.message}"

Judge the turn according to what it is trying to do. Do not demand analysis from a story, humour from an explanation, or insight from a brief reaction. It should fulfil the goal, be understandable, sound engaging and natural, remain grounded when it makes factual claims, advance the beat, and avoid needless repetition. It must remain consistent with the speaker's epistemic role and must not use prepared knowledge unavailable to that role. Experts must not feign ignorance of foundational assigned material; audience guides must not suddenly introduce unseen specialist facts. Natural fillers, pauses, hesitations, false starts and self-corrections are desirable delivery features and are not evidence of ignorance. Report in introducedCardIds only assigned cards whose substance this speech explicitly introduced aloud; availability alone is not introduction. Use Australian/British spelling in any revision. If rejected, provide focused feedback and a complete corrected version in the same speaker's voice.`,
      },
    ];

    const result = await this.callModelForToolInput<ReviewTurnInput>(
      messages,
      [toReviewTurnTool()],
      MAX_REVIEW_TOKENS
    );
    return {
      ...result,
      accepted:
        result.accepted &&
        result.roleConsistent &&
        result.knowledgeConsistent,
    };
  }
}
