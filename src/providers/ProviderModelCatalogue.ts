import { AiProviderName } from "../types";
import { ModelTier } from "./ModelRoutingPolicy";

enum AnthropicModelId {
  Economy = "claude-haiku-4-5",
  Premium = "claude-sonnet-4-5",
}

enum DeepSeekModelId {
  Economy = "deepseek-v4-flash",
  Premium = "deepseek-v4-pro",
}

const ANTHROPIC_MODELS: Record<ModelTier, string> = {
  [ModelTier.Economy]: AnthropicModelId.Economy,
  [ModelTier.Balanced]: AnthropicModelId.Premium,
  [ModelTier.Premium]: AnthropicModelId.Premium,
};

const DEEPSEEK_MODELS: Record<ModelTier, string> = {
  [ModelTier.Economy]: DeepSeekModelId.Economy,
  [ModelTier.Balanced]: DeepSeekModelId.Economy,
  [ModelTier.Premium]: DeepSeekModelId.Premium,
};

const MODELS_BY_PROVIDER: Record<
  AiProviderName,
  Record<ModelTier, string>
> = {
  [AiProviderName.Anthropic]: ANTHROPIC_MODELS,
  [AiProviderName.DeepSeek]: DEEPSEEK_MODELS,
};

/**
 * Owns provider-specific model identifiers. Application agents deal only in
 * ModelTask values, while the routing policy deals only in ModelTier values.
 */
export class ProviderModelCatalogue {
  resolve(provider: AiProviderName, tier: ModelTier): string {
    return MODELS_BY_PROVIDER[provider][tier];
  }
}
