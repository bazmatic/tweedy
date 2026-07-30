import { describe, expect, it } from "vitest";
import { AudienceProfile } from "../types";
import { AudienceAccessibilityPolicy } from "./AudienceAccessibilityPolicy";

describe("AudienceAccessibilityPolicy", () => {
  const policy = new AudienceAccessibilityPolicy();

  it("requires plain-language first use for a general audience", () => {
    const guidance = policy.buildSpeakerGuidance(AudienceProfile.General, {
      explainedTerms: [],
    });

    expect(guidance).toContain("everyday language before naming the term");
    expect(guidance).toContain("likely unfamiliar");
    expect(guidance).toContain("familiar format labels such as book or chapter");
    expect(guidance).toContain('Before using shorthand such as "the others"');
    expect(guidance).toContain("explicitly introduce");
    expect(guidance).toContain(
      "leaving the listener to guess it from the consequence alone"
    );
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

    expect(guidance).toContain("requires an unheard person, group, object, or event");
    expect(guidance).toContain(
      '"the other Cyclopes" introduces a group, while "the others" does not'
    );
  });

  it("omits the referent/antecedent rule entirely when asked to, for a cold open", () => {
    const guidance = policy.buildReviewerGuidance(AudienceProfile.General, {
      omitReferentRule: true,
    });

    expect(guidance).not.toContain("requires an unheard person, group, object, or event");
    expect(guidance).not.toContain("Keep every reference recoverable");
    expect(guidance).toContain("Identify terminology by what it asks the listener to know");
    expect(guidance).not.toContain("give it a brief gloss in the same breath");
  });

  it("tells the speaker to gloss a new substantive proper noun in the same breath", () => {
    const guidance = policy.buildSpeakerGuidance(AudienceProfile.General, {
      explainedTerms: [],
    });

    expect(guidance).toContain("give it a brief gloss in the same breath");
    expect(guidance).toContain('"the Phaeacians"');
    expect(guidance).toContain("does not need this");
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
