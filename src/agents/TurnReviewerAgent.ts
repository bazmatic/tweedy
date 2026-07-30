import {
  AudienceProfile,
  EditorialCard,
  ITurnReviewer,
  KnowledgeLedger,
  LlmMessage,
  ReviewedTurn,
  Speaker,
  Speech,
  TerminologyLedger,
  TurnBrief,
} from "../types";
import { BaseAgent } from "./BaseAgent";
import {
  ReviewTurnInput,
  reviewTurnSchema,
  RewriteRejectedTurnInput,
  rewriteRejectedTurnSchema,
} from "./editorial-schemas";
import { SpeakerRoleProfileResolver } from "./SpeakerRoleProfileResolver";
import { AudienceAccessibilityPolicy } from "./AudienceAccessibilityPolicy";
import { ModelTask } from "../providers/ModelRoutingPolicy";
import { SpeakerAgentToolName } from "./speaker-tools";

const EMPTY_KNOWLEDGE_LEDGER: KnowledgeLedger = { introducedCards: [] };
const EMPTY_TERMINOLOGY_LEDGER: TerminologyLedger = { explainedTerms: [] };
const MAX_REVIEW_TOKENS = 850;
const MAX_REWRITE_TOKENS = 180;

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
    terminologyLedger = EMPTY_TERMINOLOGY_LEDGER,
    speakers: Speaker[] = []
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
      .slice(-6)
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
    const speakerRoster = speakers.map((speaker) => speaker.name).join(", ");
    const closingStatementNote =
      speech.tool === SpeakerAgentToolName.CLOSING_STATEMENT
        ? ` This is the episode's closing statement — the final words listeners will hear. It must address the listener directly in the second person at least once (e.g. "we'll see you next time", "thanks for listening") and must sign off with an explicit farewell, not just land on a reflective final thought. It must not introduce any new topic, fact, or genuinely unresolved question that hasn't already come up earlier in the conversation above — a closing reflection on the throughline is fine, a new line of inquiry is not. It must not end on a question mark — a rhetorical, listener-directed question is acceptable only if this same turn immediately answers it before moving to the sign-off; a question left hanging at the very end is not. Only flag the new-material or trailing-question issue if it is clearly present; when in doubt, do not reject on this basis alone. If any required element is missing or violated, set accepted to false and rewrite it to add the missing sign-off, remove the new material, or resolve/drop the trailing question, in the same voice.`
        : "";
    const nearlyOutOfTimeNote =
      speech.tool === SpeakerAgentToolName.NEARLY_OUT_OF_TIME
        ? ` This turn signals the episode is nearly out of time. Check the recent conversation above: if the immediately preceding turn(s) posed a genuine question or left a concrete thread open that has not yet been answered, this turn must actually answer it in substance — not just announce time pressure and defer the answer. If it only announces urgency while leaving a real pending question unaddressed, set accepted to false and rewrite it to answer the question first, in 1-2 sentences, before or alongside the time-pressure remark, in the same voice. If there is no pending question in the recent conversation, a brief time-pressure announcement alone is acceptable and should be accepted as-is.`
        : "";
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
This episode's actual speakers: ${speakerRoster || "(unknown)"}

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

Important transcript boundary: the speech labelled "${speech.speaker.name} said" is a proposed candidate that has NOT been heard by listeners yet. It is not part of Recent conversation and must never be treated as an earlier turn, even when reviewing a correction of that candidate. If Recent conversation says this is the first turn, this candidate is the first turn; do not claim the speaker has already opened, teased, or spoken.

First perform a listener-comprehension audit. Imagine you are a listener who has heard only the spoken Recent conversation and earlier episode knowledge explicitly recorded above. You cannot see the director's goal, prepared cards, source notes, or future turns. Decide whether you can identify what this turn is talking about, resolve every necessary reference, follow how each sentence connects to the preceding exchange, and paraphrase the turn's complete point without supplying missing context yourself. If not, set clear, audienceAccessible, and accepted to false. Do not credit information merely because it appears in the goal or prepared material; it must have been spoken already or be introduced clearly in this turn.

Then judge the turn according to what it is trying to do. Do not demand analysis from a story, humour from an explanation, or insight from a brief reaction. It should fulfil the goal, be understandable, sound engaging and natural, remain grounded when it makes factual claims, advance the beat, and avoid needless repetition. When the immediately preceding speech is a brief filler comment or interjection and this speaker is continuing the thought they held before it, they should normally acknowledge the co-host's contribution in their opening few words before continuing. A short response such as "Exactly", "Right?", "I know", or "That's the point" is enough, but it must suit the actual reaction, must not falsely agree with scepticism or a challenge, and should not become the same repeated verbal tic. If the resumed speaker simply talks past the interjection, set accepted to false. Preserve conversational time continuity: phrases such as "where we left off", "to recap", "as we were saying", or "back to the story" are unnatural when the recent transcript shows an uninterrupted adjacent exchange rather than an actual break, digression, or explicit recap. In that case set accepted to false. If the goal or the immediately preceding turn explicitly asks this speaker to read, quote, or recite specific source text aloud (e.g. "read that post aloud"), a reply that only promises to do so ("here it is", "sure, let me read that") without actually reciting the material is an unmet promise: set accepted to false. It must remain consistent with the speaker's epistemic role and must not use prepared knowledge unavailable to that role. Experts must not feign ignorance of foundational assigned material; audience guides must not suddenly introduce unseen specialist facts. An expert has regressed out of character if they express discovery, confusion, or audience-surrogate surprise about a source fact they should know or have already explained. Phrases such as "So wait", "you mean", or an incredulous question about their own material are not harmless conversational colour in that context: set roleConsistent and accepted to false. An expert speaker is knowledgeable about the material, not necessarily its author: if this speech (or a co-host addressing this speaker) claims or implies they personally conducted the study, ran the experiment, or wrote the paper, and the material does not say so, set roleConsistent and accepted to false. Preserve stance continuity as well as factual consistency. This episode has a fixed cast — check the speech against "This episode's actual speakers" above: if it names, addresses, thanks, or hands off to any person by name who is not one of those listed speakers (a hallucinated guest, producer, or co-host), set castConsistent and accepted to false. Do not flag names of researchers, historical figures, or people mentioned only as the subject of the source material — this check is only for who the speaker is addressing or crediting as being present in the conversation. When the immediately preceding turn is a challenge, the challenged speaker must receive a real opportunity to respond; the challenger must not concede, reverse position, or claim that somebody replied when no such reply appears after the challenge in the chronological history. Reject any unsupported reversal. Natural fillers, pauses, hesitations, false starts and self-corrections are desirable delivery features and are not evidence of ignorance. ${this.audienceAccessibilityPolicy.buildReviewerGuidance(audienceProfile)} A concept needs explaining when it is likely unfamiliar to this audience, necessary to understand the current point, and not already explained above. Familiar words used in a specialised sense can qualify; incidental terminology that listeners do not need to understand does not. When a specialist concept carries the argument, reject unless its meaning is explained plainly in the spoken wording. Report in introducedTerms only necessary technical terms whose meaning this speech genuinely explains for the first time. Report in introducedCardIds only assigned cards whose substance this speech explicitly introduced aloud; availability alone is not introduction.${closingStatementNote}${nearlyOutOfTimeNote}

Keep your logic terse. When rejected, return one feedback item written as a plain dot-point fragment of at most 12 words. Do not quote the speech and do not propose wording. When accepted, return an empty feedback array. This call judges only; it must not rewrite the turn.`,
      },
    ];

    const result = await this.callModelForStructuredOutput<ReviewTurnInput>(
      ModelTask.TurnReview,
      messages,
      reviewTurnSchema,
      MAX_REVIEW_TOKENS
    );
    const { feedback: feedbackItems, ...judgement } = result;
    const feedback = feedbackItems?.[0] ?? "";
    const accepted =
      judgement.accepted &&
      judgement.addsVariety &&
      judgement.roleConsistent &&
      judgement.knowledgeConsistent &&
      judgement.audienceAccessible &&
      judgement.castConsistent;
    let revisedMessage = "";
    if (!accepted) {
      const wordBudget =
        speech.tool === SpeakerAgentToolName.CLOSING_STATEMENT
          ? 90
          : speech.tool === SpeakerAgentToolName.NEARLY_OUT_OF_TIME
          ? 70
          : 50;
      try {
        const rewrite = await this.callModelForStructuredOutput<RewriteRejectedTurnInput>(
          ModelTask.TurnReview,
          [
            {
              role: "user",
              content: `Rewrite this rejected podcast turn.

Speaker: ${speech.speaker.name}
Reason: ${feedback || "The turn failed editorial review."}
Goal: ${brief.goal}
Relevant prepared material:
${relevantCards || "(No specific cards assigned.)"}
Recent conversation:
${recentText || "(This is the first turn.)"}

Original turn: ${speech.message}

The original turn was rejected before broadcast. It is not conversation history, and the correction must replace it rather than reply to it.
Use the relevant prepared material above when the reason requires naming or grounding the subject. Do not assume a new listener can infer a missing person, work, or topic from the rejected original alone.

Return only one complete corrected spoken turn in the same voice, no longer than ${wordBudget} words. Use one unbroken line. Use Australian/British spelling. Do not include analysis, labels, dot points, quotations around the answer, markdown, card ids, or citations.`,
            },
          ],
          rewriteRejectedTurnSchema,
          MAX_REWRITE_TOKENS
        );
        revisedMessage = rewrite.message.trim();
      } catch {
        // Keep the valid rejection. The director will discard this candidate
        // rather than losing the verdict or accepting known-bad speech.
      }
    }
    return {
      ...judgement,
      feedback,
      revisedMessage,
      accepted,
    };
  }
}
