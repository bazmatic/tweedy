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

  it("resolves every OpenAI tier", () => {
    for (const tier of Object.values(ModelTier)) {
      expect(catalogue.resolve(AiProviderName.OpenAI, tier)).toBeTruthy();
    }
  });

  it("resolves every Grok tier", () => {
    for (const tier of Object.values(ModelTier)) {
      expect(catalogue.resolve(AiProviderName.Grok, tier)).toBeTruthy();
    }
  });

  it("keeps provider-specific model choices independent", () => {
    expect(
      catalogue.resolve(AiProviderName.Anthropic, ModelTier.Economy)
    ).not.toBe(
      catalogue.resolve(AiProviderName.DeepSeek, ModelTier.Economy)
    );
  });

  it("resolves OpenAI tiers to expected model ids", () => {
    expect(catalogue.resolve(AiProviderName.OpenAI, ModelTier.Economy)).toBe(
      "gpt-5-mini"
    );
    expect(catalogue.resolve(AiProviderName.OpenAI, ModelTier.Balanced)).toBe(
      "gpt-5-mini"
    );
    expect(catalogue.resolve(AiProviderName.OpenAI, ModelTier.Premium)).toBe(
      "gpt-5"
    );
  });

  it("resolves Grok tiers to expected model ids", () => {
    expect(catalogue.resolve(AiProviderName.Grok, ModelTier.Economy)).toBe(
      "grok-4-fast"
    );
    expect(catalogue.resolve(AiProviderName.Grok, ModelTier.Balanced)).toBe(
      "grok-4-fast"
    );
    expect(catalogue.resolve(AiProviderName.Grok, ModelTier.Premium)).toBe(
      "grok-4.5"
    );
  });
});
