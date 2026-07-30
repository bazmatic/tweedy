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
});
