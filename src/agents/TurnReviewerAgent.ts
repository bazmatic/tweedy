import {
  AudienceProfile,
  EditorialCard,
  ITurnReviewer,
  KnowledgeLedger,
  LlmMessage,
  ReviewedTurn,
  Speech,
  TerminologyLedger,
  TurnBrief,
} from "../types";
import { BaseAgent } from "./BaseAgent";
import {
  ReviewTurnInput,
  reviewTurnSchema,
} from "./editorial-schemas";
import { SpeakerRoleProfileResolver } from "./SpeakerRoleProfileResolver";
import { AudienceAccessibilityPolicy } from "./AudienceAccessibilityPolicy";
import { ModelTask } from "../providers/ModelRoutingPolicy";
import { SpeakerAgentToolName } from "./speaker-tools";

const EMPTY_KNOWLEDGE_LEDGER: KnowledgeLedger = { introducedCards: [] };
const EMPTY_TERMINOLOGY_LEDGER: TerminologyLedger = { explainedTerms: [] };
const MAX_REVIEW_TOKENS = 850;

export class TurnReviewerAgent extends BaseAgent implements ITurnReviewer {
  constructor(
    private readonly roleProfileResolver = new SpeakerRoleProfileResolver(),
    private readonly audienceAccessibilityPolicy = new AudienceAccessibilityPolicy()
  ) {
    super();
  }

  async review(
    speech: Speech,
    brief: TurnBrief,
    cards: EditorialCard[],
    recentSpeeches: Speech[],
    knowledgeLedger: KnowledgeLedger = EMPTY_KNOWLEDGE_LEDGER,
    audienceProfile = AudienceProfile.General,
    terminologyLedger = EMPTY_TERMINOLOGY_LEDGER
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
      .map(
        (item) =>
          `${item.speaker.name}: ${item.message} [${
            item.tool ?? SpeakerAgentToolName.SPEAK
          }]`
      )
      .join("\n");
    const sameSpeakerHistory = recentSpeeches
      .filter((item) => item.speaker.id === speech.speaker.id)
      .slice(-3)
      .map((item) => `- ${item.message}`)
      .join("\n");
    const explainedTerms = terminologyLedger.explainedTerms
      .map((entry) => `- ${entry.term}: ${entry.plainLanguageMeaning}`)
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
Audience profile: ${audienceProfile}

Relevant prepared material:
${relevantCards || "(No specific cards assigned.)"}

Knowledge status:
${knowledgeStatus || "(No prepared cards assigned.)"}

Technical terms already explained aloud:
${explainedTerms || "(None.)"}

Recent conversation:
${recentText || "(This is the first turn.)"}

What this speaker has already said recently:
${sameSpeakerHistory || "(This speaker has not spoken yet.)"}

${speech.speaker.name} said: "${speech.message}"

Judge the turn according to what it is trying to do. Do not demand analysis from a story, humour from an explanation, or insight from a brief reaction. It should fulfil the goal, be understandable, sound engaging and natural, remain grounded when it makes factual claims, advance the beat, and avoid needless repetition. It must remain consistent with the speaker's epistemic role and must not use prepared knowledge unavailable to that role. Experts must not feign ignorance of foundational assigned material; audience guides must not suddenly introduce unseen specialist facts. An expert has regressed out of character if they express discovery, confusion, or audience-surrogate surprise about a source fact they should know or have already explained. Phrases such as "So wait", "you mean", or an incredulous question about their own material are not harmless conversational colour in that context: set roleConsistent and accepted to false, then rewrite the turn as a confident clarification of why the fact matters. Preserve stance continuity as well as factual consistency. When the immediately preceding turn is a challenge, the challenged speaker must receive a real opportunity to respond; the challenger must not concede, reverse position, or claim that somebody replied when no such reply appears after the challenge in the chronological history. Reject and revise any unsupported reversal. Natural fillers, pauses, hesitations, false starts and self-corrections are desirable delivery features and are not evidence of ignorance. ${this.audienceAccessibilityPolicy.buildReviewerGuidance(audienceProfile)} A concept needs explaining when it is likely unfamiliar to this audience, necessary to understand the current point, and not already explained above. Familiar words used in a specialised sense can qualify; incidental terminology that listeners do not need to understand does not. When a specialist concept carries the argument, reject and revise unless its meaning is explained plainly in the spoken wording. Report in introducedTerms only necessary technical terms whose meaning this speech genuinely explains for the first time. Report in introducedCardIds only assigned cards whose substance this speech explicitly introduced aloud; availability alone is not introduction. Use Australian/British spelling in any revision. If rejected, return exactly one feedback item and exactly one revisedMessages item containing a complete corrected version in the same speaker's voice, no longer than 50 words. When accepted is true, return empty arrays for both feedback and revisedMessages.`,
      },
    ];

    const result = await this.callModelForStructuredOutput<ReviewTurnInput>(
      ModelTask.TurnReview,
      messages,
      reviewTurnSchema,
      MAX_REVIEW_TOKENS
    );
    const {
      feedback: feedbackItems,
      revisedMessages,
      ...judgement
    } = result;
    const feedback = feedbackItems?.[0] ?? "";
    const revisedMessage = revisedMessages?.[0] ?? "";
    return {
      ...judgement,
      feedback,
      revisedMessage,
      accepted:
        judgement.accepted &&
        judgement.roleConsistent &&
        judgement.knowledgeConsistent &&
        judgement.audienceAccessible &&
        !revisedMessage,
    };
  }
}
