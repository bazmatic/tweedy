import {
  AudienceProfile,
  TerminologyLedger,
} from "../types";

const AUDIENCE_GUIDANCE: Readonly<Record<AudienceProfile, string>> =
  Object.freeze({
    [AudienceProfile.General]:
      "Assume listeners have no specialist training. When a necessary specialist concept first appears, explain the idea in everyday language before naming the term. Treat a compressed label as unfamiliar only when the surrounding speech does not make its meaning clear; this includes ordinary words used in a genuinely specialised sense, formal terminology, and proper nouns or surnames that stand for an idea, method, law, scale or effect. Do not demand definitions for ordinary words, simple counts, familiar format labels such as book or chapter, transparent metaphors, or a term whose useful meaning is obvious from the sentence. A proper noun used only to identify a person, place or organisation does not need defining. Introduce at most one new specialist concept in a turn and prefer a concrete example or analogy.",
    [AudienceProfile.Enthusiast]:
      "Assume listeners know the broad subject but not its specialist vocabulary. Briefly define domain-specific terms on first use and connect them to familiar ideas.",
    [AudienceProfile.Specialist]:
      "Assume listeners know standard terminology in the field. Explain only unusually specialised, ambiguous or newly coined terms that are necessary to follow the point.",
  });

const REFERENT_GUIDANCE =
  'Keep every reference recoverable from the spoken conversation. Before using shorthand such as "the others", "they", "the second group", or "that response", explicitly introduce the people, group, object, or event it refers to. Do not rely on prepared notes or a later claim to supply an antecedent the listener has not heard. The same rule applies when a payoff depends on an earlier hidden action, choice, or fact — such as a disguise, a trick, a false name, or a withheld detail — that has not itself been described aloud: state that antecedent plainly rather than only gesturing at its consequence. A listener must never have to infer what was hidden or done from the outcome alone.';

/** Defines listener accessibility without changing a speaker's expertise or delivery style. */
export class AudienceAccessibilityPolicy {
  buildSpeakerGuidance(
    audienceProfile: AudienceProfile,
    terminologyLedger: TerminologyLedger
  ): string {
    const explainedTerms = terminologyLedger.explainedTerms
      .map((entry) => entry.term)
      .join(", ");

    return `${AUDIENCE_GUIDANCE[audienceProfile]} ${REFERENT_GUIDANCE} A term needs explanation only when it is likely unfamiliar to this audience, necessary to understand the point, and not already explained in the episode. Previously explained terms: ${
      explainedTerms || "none"
    }.`;
  }

  buildReviewerGuidance(audienceProfile: AudienceProfile): string {
    return `${AUDIENCE_GUIDANCE[audienceProfile]} ${REFERENT_GUIDANCE} Reject and revise a turn when a definite reference or pronoun requires an unheard person, group, object, or event to make sense. For example, "the other Cyclopes" introduces a group, while "the others" does not if no group has previously been named. Identify terminology by what it asks the listener to know, not by spelling, capitalisation or suffixes. Pay particular attention to proper nouns and surnames: when a name is shorthand for a concept it may need explaining, while simple attribution does not. Mark the turn audience-accessible when listeners can understand every concept necessary to follow the argument; do not require optional historical or technical precision beyond that bar. A consequence or example appearing after a specialist label is not automatically a definition: listeners should be able to paraphrase what the concept means. Do not penalise incidental names or terms whose precise meaning is unnecessary to follow the point.`;
  }

  buildDirectorGuidance(audienceProfile: AudienceProfile): string {
    return `\n\nAudience accessibility (${audienceProfile}): ${AUDIENCE_GUIDANCE[audienceProfile]} ${REFERENT_GUIDANCE} The expert owns the primary responsibility for translating expertise. The audience guide may ask for clarification when a necessary term remains unclear.`;
  }
}
