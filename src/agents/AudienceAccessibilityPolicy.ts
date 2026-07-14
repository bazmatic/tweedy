import {
  AudienceProfile,
  TerminologyLedger,
} from "../types";

const AUDIENCE_GUIDANCE: Readonly<Record<AudienceProfile, string>> =
  Object.freeze({
    [AudienceProfile.General]:
      "Assume listeners have no specialist training. When a necessary technical term first appears, explain the idea in everyday language before naming the term. Introduce at most one new technical term in a turn and prefer a concrete example or analogy.",
    [AudienceProfile.Enthusiast]:
      "Assume listeners know the broad subject but not its specialist vocabulary. Briefly define domain-specific terms on first use and connect them to familiar ideas.",
    [AudienceProfile.Specialist]:
      "Assume listeners know standard terminology in the field. Explain only unusually specialised, ambiguous or newly coined terms that are necessary to follow the point.",
  });

/** Defines listener accessibility without changing a speaker's expertise or delivery style. */
export class AudienceAccessibilityPolicy {
  buildSpeakerGuidance(
    audienceProfile: AudienceProfile,
    terminologyLedger: TerminologyLedger
  ): string {
    const explainedTerms = terminologyLedger.explainedTerms
      .map((entry) => entry.term)
      .join(", ");

    return `${AUDIENCE_GUIDANCE[audienceProfile]} A term needs explanation only when it is likely unfamiliar to this audience, necessary to understand the point, and not already explained in the episode. Previously explained terms: ${
      explainedTerms || "none"
    }.`;
  }

  buildReviewerGuidance(audienceProfile: AudienceProfile): string {
    return `${AUDIENCE_GUIDANCE[audienceProfile]} Mark the turn audience-accessible only when listeners can understand its necessary concepts without unexplained specialist knowledge. Do not penalise incidental names or terms whose precise meaning is unnecessary to follow the point.`;
  }

  buildDirectorGuidance(audienceProfile: AudienceProfile): string {
    return `\n\nAudience accessibility (${audienceProfile}): ${AUDIENCE_GUIDANCE[audienceProfile]} The expert owns the primary responsibility for translating expertise. The audience guide may ask for clarification when a necessary term remains unclear.`;
  }
}
