import { describe, expect, it } from "vitest";
import { AiProviderName } from "../types";
import { ModelTier } from "./ModelRoutingPolicy";
import { ProviderModelCatalogue } from "./ProviderModelCatalogue";

describe("ProviderModelCatalogue", () => {
  const catalogue = new ProviderModelCatalogue();

  it("resolves every Anthropic tier", () => {
    for (const tier of Object.values(ModelTier)) {
      expect(catalogue.resolve(AiProviderName.Anthropic, tier)).toBeTruthy();
    }
  });

  it("resolves every DeepSeek tier", () => {
    for (const tier of Object.values(ModelTier)) {
      expect(catalogue.resolve(AiProviderName.DeepSeek, tier)).toBeTruthy();
    }
  });

  it("keeps provider-specific model choices independent", () => {
    expect(
      catalogue.resolve(AiProviderName.Anthropic, ModelTier.Economy)
    ).not.toBe(
      catalogue.resolve(AiProviderName.DeepSeek, ModelTier.Economy)
    );
  });
});
