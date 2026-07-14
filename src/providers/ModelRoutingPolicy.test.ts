import { describe, expect, it } from "vitest";
import { ModelRoutingPolicy, ModelTask, ModelTier } from "./ModelRoutingPolicy";

describe("ModelRoutingPolicy", () => {
  const policy = new ModelRoutingPolicy();

  it("reserves premium models for planning, preparation and substantive speech", () => {
    expect(policy.resolve(ModelTask.MaterialPreparation)).toBe(ModelTier.Premium);
    expect(policy.resolve(ModelTask.MaterialSummary)).toBe(ModelTier.Premium);
    expect(policy.resolve(ModelTask.EpisodePlanning)).toBe(ModelTier.Premium);
    expect(policy.resolve(ModelTask.SpeechGeneration)).toBe(ModelTier.Premium);
    expect(policy.resolve(ModelTask.TurnReview)).toBe(ModelTier.Premium);
  });

  it("uses balanced models for direction selection", () => {
    expect(policy.resolve(ModelTask.DirectionSelection)).toBe(ModelTier.Balanced);
  });

  it("uses economy models for constrained checks and short transformations", () => {
    expect(policy.resolve(ModelTask.CoverageVerification)).toBe(ModelTier.Economy);
    expect(policy.resolve(ModelTask.ConclusionCheck)).toBe(ModelTier.Economy);
    expect(policy.resolve(ModelTask.Interjection)).toBe(ModelTier.Economy);
    expect(policy.resolve(ModelTask.SpeechEffectTagging)).toBe(ModelTier.Economy);
  });
});
