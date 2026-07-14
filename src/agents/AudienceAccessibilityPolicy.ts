import {
  AudienceProfile,
  TerminologyLedger,
} from "../types";

const AUDIENCE_GUIDANCE: Readonly<Record<AudienceProfile, string>> =
  Object.freeze({
    [AudienceProfile.General]:
      "Assume listeners have no specialist training. When a necessary specialist concept first appears, explain the idea in everyday language before naming the term. Treat any compressed label as unfamiliar unless the surrounding speech makes its meaning clear; this includes ordinary words used in a specialised sense, formal terminology, and proper nouns or surnames that stand for an idea, method, law, scale or effect. A proper noun used only to identify a person, place or organisation does not need defining. Introduce at most one new specialist concept in a turn and prefer a concrete example or analogy.",
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
    return `${AUDIENCE_GUIDANCE[audienceProfile]} Identify terminology by what it asks the listener to know, not by spelling, capitalisation or suffixes. Pay particular attention to proper nouns and surnames: when a name is shorthand for a concept it may need explaining, while simple attribution does not. Mark the turn audience-accessible only when listeners can understand every concept necessary to follow the argument. A consequence or example appearing after a specialist label is not automatically a definition: listeners should be able to paraphrase what the concept means. Do not penalise incidental names or terms whose precise meaning is unnecessary to follow the point.`;
  }

  buildDirectorGuidance(audienceProfile: AudienceProfile): string {
    return `\n\nAudience accessibility (${audienceProfile}): ${AUDIENCE_GUIDANCE[audienceProfile]} The expert owns the primary responsibility for translating expertise. The audience guide may ask for clarification when a necessary term remains unclear.`;
  }
}
