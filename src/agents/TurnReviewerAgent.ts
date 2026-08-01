import {
  AudienceProfile,
  EditorialCard,
  EditorialMove,
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
// Wider than the 6-turn recentText window used for conversational flow —
// repeated content is often said by a DIFFERENT speaker further back than
// that, and the old same-speaker-only history missed it entirely since it
// both filtered by speaker and used an even shorter window.
const REPETITION_HISTORY_LIMIT = 20;

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
    speakers: Speaker[] = [],
    priorRejectionReason?: string
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
    // Anyone's content counts as "already said", not just this speaker's
    // own lines — a rephrase of a point a co-host made five turns ago is
    // still a repeat.
    const repetitionHistory = recentSpeeches
      .slice(-REPETITION_HISTORY_LIMIT)
      .map((item) => `- ${item.speaker.name}: ${item.message}`)
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
    const revisionContextNote = priorRejectionReason
      ? ` This is a corrected rewrite of an earlier candidate that you rejected for: "${priorRejectionReason}". Check specifically whether that problem is now fixed. If it is fixed, do not reject the turn again for a different, marginal reading of the same rubric — only reject for that original problem still being present, or for a distinct, clearly present issue.`
      : "";
    const isColdOpen = speech.tool === SpeakerAgentToolName.COLD_OPEN;
    // A cold open deliberately withholds who or what it's about as a hook
    // (like a magazine teaser) — the ordinary comprehension audit's
    // identify-every-reference requirement is simply the wrong rule for this
    // turn, so it is left out of the prompt entirely rather than included
    // and then countermanded; a rule the model never sees can't be
    // misapplied.
    const comprehensionAuditNote = isColdOpen
      ? `First perform a listener-comprehension audit. Imagine you are a listener hearing this as the very first thing in the episode, with no context yet given. This is the cold open: a deliberately mysterious tease, like a magazine article's teaser. Withholding who "you" or "he" refers to, or naming a person or place without yet explaining who or what they are, is the intended hook technique here — do not require the subject, a pronoun, or a named person or place to already be identified. Decide only whether the sentence is coherent and could be followed word to word on its own terms. If it is simply incoherent or nonsensical regardless of who it's about, set clear and accepted to false. Do not credit information merely because it appears in the goal or prepared material; it must be grounded in that material, not invented.`
      : `First perform a listener-comprehension audit. Imagine you are a listener who has heard only the spoken Recent conversation and earlier episode knowledge explicitly recorded above. You cannot see the director's goal, prepared cards, source notes, or future turns. Decide whether you can identify what this turn is talking about, resolve every necessary reference, follow how each sentence connects to the preceding exchange, and paraphrase the turn's complete point without supplying missing context yourself. If not, set clear, audienceAccessible, and accepted to false. Do not credit information merely because it appears in the goal or prepared material; it must have been spoken already or be introduced clearly in this turn.`;
    // A turn whose job is to ask about a term — whatever move the director
    // assigned it — cannot also contain that term's answer; the answer is
    // expected from whoever responds. Detected structurally (the goal is to
    // ask, or the turn poses a question anywhere in it, e.g. "What is a
    // widget? I don't know."), not just by a single move label, since a
    // question can appear inside other moves too.
    const isQuestionTurn =
      brief.move === EditorialMove.Question || speech.message.includes("?");
    const termExplanationRequirement = isQuestionTurn
      ? "A concept needs a plain-language explanation only from the turn that answers or asserts it — a turn whose job is to ask about the concept (this one) is not expected to explain it in the same breath; that explanation belongs to whoever responds. Do not reject this turn merely for asking about an unexplained term."
      : "A concept needs explaining when it is likely unfamiliar to this audience, necessary to understand the current point, and not already explained above. Familiar words used in a specialised sense can qualify; incidental terminology that listeners do not need to understand does not. When a specialist concept carries the argument, reject unless its meaning is explained plainly in the spoken wording.";
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

What has already been said in the episode so far, by any speaker (check for a fact, claim, comparison, or example this turn substantively repeats, even if reworded — not just this speaker's own lines):
${repetitionHistory || "(Nothing has been said yet.)"}

${speech.speaker.name} said: "${speech.message}"

Important transcript boundary: the speech labelled "${speech.speaker.name} said" is a proposed candidate that has NOT been heard by listeners yet. It is not part of Recent conversation and must never be treated as an earlier turn, even when reviewing a correction of that candidate. If Recent conversation says this is the first turn, this candidate is the first turn; do not claim the speaker has already opened, teased, or spoken.${revisionContextNote}

${comprehensionAuditNote}

Judge the turn by its goal and format.

- Reject needless repetition; allow callbacks that build on earlier material or add a new angle. Never reject a turn for repeating or closely paraphrasing the cold open's hook, image, or question — that reprise is expected.
- After a brief interjection, acknowledge it before resuming. Preserve time continuity and fulfil any explicit request to read or quote material.
- Enforce the speaker's role and available knowledge. Experts must not feign ignorance or claim authorship without support; audience guides must not introduce unseen specialist facts.
- Reject invented cast members, unsupported stance reversals, or claims that an unanswered challenge received a reply. A speaker may share a name with a real public figure (living, historical, or fictional) — that is an intentional persona choice, not grounds for rejection on its own. Judge castConsistent only against "This episode's actual speakers" above: if the name speaking matches a name on that list, the cast is consistent, regardless of who that name refers to in the real world.
- Treat natural fillers, pauses, and self-corrections as valid speech.
- Do not reject a turn merely because it only partially covers a goal with several parts (e.g. a list of items, or multiple facts to establish) — a natural turn may address a subset now and leave the rest for a follow-up turn. Judge accessibility and clarity only against what the turn actually says: an item it doesn't mention isn't an accessibility violation, but an item it does mention must still be named and used correctly, not left as a dangling unexplained reference the turn itself relies on.

${this.audienceAccessibilityPolicy.buildReviewerGuidance(audienceProfile, { omitReferentRule: isColdOpen })} ${termExplanationRequirement} Report only newly explained necessary terms in introducedTerms, and only assigned cards actually spoken in introducedCardIds.${closingStatementNote}${nearlyOutOfTimeNote}

Keep your logic terse. When rejected, return one feedback item written as one plain sentence, grounded in a specific word or phrase from the speech. Do not propose wording. When accepted, return an empty feedback array. This call judges only; it must not rewrite the turn.`,
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
          : 75;
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
Fix only the specific problem named in Reason — every other person, show, term, or reference the original turn already resolved must still be resolved in your rewrite. Do not silently drop an already-established reference to make room for the fix; if both cannot fit, keep the fix and trim elsewhere in the sentence (word choice, filler, secondary detail) rather than cutting a resolved reference.

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
