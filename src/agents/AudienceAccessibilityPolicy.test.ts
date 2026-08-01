import { describe, expect, it } from "vitest";
import { AudienceProfile } from "../types";
import { AudienceAccessibilityPolicy } from "./AudienceAccessibilityPolicy";

describe("AudienceAccessibilityPolicy", () => {
  const policy = new AudienceAccessibilityPolicy();

  it("requires plain-language first use for a general audience", () => {
    const guidance = policy.buildSpeakerGuidance(AudienceProfile.General, {
      explainedTerms: [],
    });

    expect(guidance).toContain("in plain language when first used");
    expect(guidance).toContain("likely to be unfamiliar");
    expect(guidance).toContain("concrete example or analogy");
    expect(guidance).toContain("Name what pronouns or shorthand refer to");
    expect(guidance).toContain("hidden fact needed to understand the point");
  });

  it("shows terms that listeners have already heard explained", () => {
    const guidance = policy.buildSpeakerGuidance(AudienceProfile.General, {
      explainedTerms: [
        {
          term: "Shannon entropy",
          plainLanguageMeaning: "how unpredictable a signal is",
          explainedBySpeakerId: "expert",
          explainedAtTurn: 2,
        },
      ],
    });

    expect(guidance).toContain("Previously explained terms: Shannon entropy");
  });

  it("requires reviewers to reject references with unheard antecedents", () => {
    const guidance = policy.buildReviewerGuidance(AudienceProfile.General);

    expect(guidance).toContain(
      "requires knowledge of an unheard person, group, object, or event"
    );
    expect(guidance).toContain("to even make sense");
  });

  it("omits the referent/antecedent rule entirely when asked to, for a cold open", () => {
    const guidance = policy.buildReviewerGuidance(AudienceProfile.General, {
      omitReferentRule: true,
    });

    expect(guidance).not.toContain("requires an unheard person, group, object, or event");
    expect(guidance).not.toContain("Keep every reference recoverable");
    expect(guidance).toContain("Mark the turn audience-accessible");
    expect(guidance).not.toContain("give it a brief gloss in the same breath");
  });

  it("tells the speaker to gloss a new substantive proper noun in the same breath", () => {
    const guidance = policy.buildSpeakerGuidance(AudienceProfile.General, {
      explainedTerms: [],
    });

    expect(guidance).toContain("Briefly explain any new proper noun essential");
    expect(guidance).toContain("Incidental names need no explanation");
  });

  it("does not add a new rejection ground for reviewers over ungrossed proper nouns", () => {
    // This is a generation-time habit for the speaker, not a new way for the
    // reviewer to reject a turn — the reviewer's rejection surface should be
    // unchanged.
    const guidance = policy.buildReviewerGuidance(AudienceProfile.General);

    expect(guidance).not.toContain("give it a brief gloss in the same breath");
    expect(guidance).not.toContain("substantive new proper noun");
  });
});
