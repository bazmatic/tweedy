import {
  AudienceProfile,
  TerminologyLedger,
} from "../types";

const AUDIENCE_GUIDANCE: Readonly<Record<AudienceProfile, string>> =
  Object.freeze({
    [AudienceProfile.General]:
      "Assume no specialist knowledge. Explain  essential terms likely to be unfamiliar to general audiences in plain language when first used -- preferably with a concrete example or analogy.",
    [AudienceProfile.Enthusiast]:
      "Assume listeners know the broad subject but not its specialist vocabulary. Briefly define domain-specific terms on first use and connect them to familiar ideas.",
    [AudienceProfile.Specialist]:
      "Assume listeners know standard terminology in the field. Explain only unusually specialised, ambiguous or newly coined terms that are necessary to follow the point.",
  });

const REFERENT_GUIDANCE =
  "Make every reference clear from the spoken conversation. Name what pronouns or shorthand refer to, and state any hidden fact needed to understand the point.";

// Speaker-facing only, deliberately not part of REFERENT_GUIDANCE: this is a
// generation-time habit to prevent the gap, not a new rejection ground for
// the reviewer to apply after the fact.
const PROPER_NOUN_GLOSS_GUIDANCE =
  "Briefly explain any new proper noun essential to the point. Incidental names need no explanation.";

/** Defines listener accessibility without changing a speaker's expertise or delivery style. */
export class AudienceAccessibilityPolicy {
  buildSpeakerGuidance(
    audienceProfile: AudienceProfile,
    terminologyLedger: TerminologyLedger
  ): string {
    const explainedTerms = terminologyLedger.explainedTerms
      .map((entry) => entry.term)
      .join(", ");

    return `${AUDIENCE_GUIDANCE[audienceProfile]} ${REFERENT_GUIDANCE} ${PROPER_NOUN_GLOSS_GUIDANCE} A term needs explanation only when it is likely unfamiliar to this audience, necessary to understand the point, and not already explained in the episode. Previously explained terms: ${
      explainedTerms || "none"
    }.`;
  }

  /**
   * `omitReferentRule` drops the antecedent/reference requirement entirely —
   * for a cold open, which deliberately withholds who or what it's about as
   * a hook, that rule is simply the wrong rule rather than one to apply and
   * then override.
   */
  buildReviewerGuidance(
    audienceProfile: AudienceProfile,
    options?: { omitReferentRule?: boolean }
  ): string {
    const referentSection = options?.omitReferentRule
      ? ""
      : ` ${REFERENT_GUIDANCE} Reject and revise a turn when something is mentioned that *definitely* requires knowledge of an unheard person, group, object, or event to even make sense.`;
    return `${AUDIENCE_GUIDANCE[audienceProfile]}${referentSection} Mark the turn audience-accessible when a new listener could probably understand every concept necessary to follow the argument. Do not penalise incidental names or terms whose precise meaning is unnecessary to follow the point.`;
  }

  buildDirectorGuidance(audienceProfile: AudienceProfile): string {
    return `\n\nAudience accessibility (${audienceProfile}): ${AUDIENCE_GUIDANCE[audienceProfile]} ${REFERENT_GUIDANCE} The expert owns the primary responsibility for translating expertise. The audience guide may ask for clarification when a necessary term remains unclear.`;
  }
}
