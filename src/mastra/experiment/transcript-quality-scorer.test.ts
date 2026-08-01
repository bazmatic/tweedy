import { describe, expect, it } from "vitest";
import {
  averageQualityScore,
  buildQualityPrompt,
  buildTranscript,
  formatQualityReason,
  QualityAnalysis,
} from "./transcript-quality-scorer";

describe("buildTranscript", () => {
  it("joins speaker turns into speakerId: message lines", () => {
    const result = buildTranscript([
      { speakerId: "alice", message: "Welcome to the show." },
      { speakerId: "bob", message: "Glad to be here." },
    ]);
    expect(result).toBe("alice: Welcome to the show.\nbob: Glad to be here.");
  });

  it("returns an empty string for no turns", () => {
    expect(buildTranscript([])).toBe("");
  });
});

describe("buildQualityPrompt", () => {
  it("includes the transcript and all four rubric dimensions", () => {
    const prompt = buildQualityPrompt("alice: hello");
    expect(prompt).toContain("alice: hello");
    expect(prompt).toContain("engaging");
    expect(prompt).toContain("informative");
    expect(prompt).toContain("coherent");
    expect(prompt).toContain("understandable");
  });
});

function analysis(overrides: Partial<QualityAnalysis> = {}): QualityAnalysis {
  return {
    engaging: { score: 4, reason: "varied pacing" },
    informative: { score: 5, reason: "concrete detail" },
    coherent: { score: 3, reason: "one dropped thread" },
    understandable: { score: 4, reason: "clear language" },
    ...overrides,
  };
}

describe("averageQualityScore", () => {
  it("averages the four dimension scores and normalizes to 0-1", () => {
    // (4 + 5 + 3 + 4) / 4 = 4; 4 / 5 = 0.8
    expect(averageQualityScore(analysis())).toBeCloseTo(0.8);
  });
});

describe("formatQualityReason", () => {
  it("concatenates each dimension's score and reason", () => {
    const result = formatQualityReason(analysis());
    expect(result).toBe(
      "engaging=4 (varied pacing); informative=5 (concrete detail); coherent=3 (one dropped thread); understandable=4 (clear language)"
    );
  });
});
