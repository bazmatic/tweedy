import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { AiProviderName } from "../types";
import { ModelRoutingPolicy, ModelTask, ModelTier } from "./ModelRoutingPolicy";
import { ProviderModelCatalogue } from "./ProviderModelCatalogue";

// Reasoning tokens are drawn from the same budget as visible output for
// OpenAI's reasoning models, so maxTokens (sized to enforce brevity in the
// visible response) needs extra headroom on top for the model to reason in,
// or it can return truncated or missing output. Premium tasks reason at
// "medium" effort (see below) and burn through more reasoning tokens than
// "minimal", so they get a larger buffer.
const OPENAI_REASONING_TOKEN_BUFFER = 3000;
const OPENAI_PREMIUM_REASONING_TOKEN_BUFFER = 6000;

// DeepSeek routinely overshoots the brevity guidance baked into our prompts
// (e.g. "1-2 sentences, under 50 words") and burns through maxTokens before
// finishing the tool-call JSON, which otherwise surfaces as a truncated tool
// call on nearly every turn. Give it the same kind of headroom OpenAI's
// reasoning models get above, so a verbose response still finishes inside
// its JSON structure instead of being cut off mid-argument.
const DEEPSEEK_TOKEN_BUFFER = 100;

// Kimi has the same tendency as DeepSeek to overshoot this app's brevity
// guidance (e.g. "1-2 sentences, 15-35 words") and run out of maxTokens
// mid-sentence, which surfaces as speeches truncated by stopReason
// "max_tokens" far more often than other providers. Give it the same kind
// of headroom so a verbose turn finishes its thought before hitting the cap.
const KIMI_TOKEN_BUFFER = 100;

export class AiModelFactory {
  private static models: Map<string, BaseChatModel> = new Map();
  private static routingPolicy = new ModelRoutingPolicy();
  private static modelCatalogue = new ProviderModelCatalogue();

  static getModel(
    provider: AiProviderName,
    task: ModelTask,
    maxTokens: number
  ): BaseChatModel {
    const tier = this.routingPolicy.resolve(task);
    const modelId = this.modelCatalogue.resolve(provider, tier);
    const temperature = this.routingPolicy.resolveTemperature(task);
    const key = `${provider}:${modelId}:${maxTokens}:${temperature ?? "default"}`;

    if (!this.models.has(key)) {
      switch (provider) {
        case AiProviderName.Anthropic: {
          const apiKey = process.env.ANTHROPIC_API_KEY;
          if (!apiKey) {
            throw new Error(
              "ANTHROPIC_API_KEY environment variable is required"
            );
          }
          // Anthropic's API caps temperature at 1.0 (already its default for
          // these models, and newer models 400 on any other value), so there
          // is no headroom to raise it further — omit it and let the model
          // use its default rather than pass a value the API may reject.
          const model = new ChatAnthropic({
            apiKey,
            model: modelId,
            maxTokens,
          });
          this.models.set(key, model);
          break;
        }
        case AiProviderName.DeepSeek: {
          const apiKey = process.env.DEEPSEEK_API_KEY;
          if (!apiKey) {
            throw new Error(
              "DEEPSEEK_API_KEY environment variable is required"
            );
          }
          // Thinking mode defaults to enabled and rejects `tool_choice`
          // outright ("Thinking mode does not support this tool_choice"),
          // which this app relies on to force tool calls. Disable it since
          // these short conversational turns don't need reasoning.
          const model = new ChatOpenAI({
            apiKey,
            model: modelId,
            maxTokens: maxTokens + DEEPSEEK_TOKEN_BUFFER,
            temperature,
            configuration: { baseURL: "https://api.deepseek.com" },
            modelKwargs: { thinking: { type: "disabled" } },
          });
          this.models.set(key, model);
          break;
        }
        case AiProviderName.OpenAI: {
          const apiKey = process.env.OPENAI_API_KEY;
          if (!apiKey) {
            throw new Error(
              "OPENAI_API_KEY environment variable is required"
            );
          }
          // gpt-5 models reason by default; effort is kept at "minimal" for
          // economy/balanced tasks since those are short turns that don't
          // need deep reasoning, but premium tasks get more room to reason.
          // The API call still needs OPENAI_REASONING_TOKEN_BUFFER on top of
          // maxTokens for that reasoning (see constant above).
          const isPremium = tier === ModelTier.Premium;
          const model = new ChatOpenAI({
            apiKey,
            model: modelId,
            maxTokens:
              maxTokens +
              (isPremium
                ? OPENAI_PREMIUM_REASONING_TOKEN_BUFFER
                : OPENAI_REASONING_TOKEN_BUFFER),
            reasoning: { effort: isPremium ? "medium" : "minimal" },
          });
          this.models.set(key, model);
          break;
        }
        case AiProviderName.Grok: {
          const apiKey = process.env.XAI_API_KEY;
          if (!apiKey) {
            throw new Error("XAI_API_KEY environment variable is required");
          }
          const model = new ChatOpenAI({
            apiKey,
            model: modelId,
            maxTokens,
            temperature,
            configuration: { baseURL: "https://api.x.ai/v1" },
          });
          this.models.set(key, model);
          break;
        }
        case AiProviderName.Kimi: {
          const apiKey = process.env.MOONSHOT_API_KEY;
          if (!apiKey) {
            throw new Error(
              "MOONSHOT_API_KEY environment variable is required"
            );
          }
          // Moonshot's API rejects any temperature other than the default of
          // 1 ("invalid temperature: only 1 is allowed for this model"), so
          // omit it rather than pass the task-specific value other
          // providers get — same reasoning as the Anthropic case above.
          //
          // kimi-k3 also has thinking mode enabled by default, and rejects a
          // forced tool_choice outright ("tool_choice 'specified' is
          // incompatible with thinking enabled") — this app relies on forced
          // tool calls for every turn, so disable it, same as the DeepSeek
          // case above.
          const model = new ChatOpenAI({
            apiKey,
            model: modelId,
            maxTokens: maxTokens + KIMI_TOKEN_BUFFER,
            configuration: { baseURL: "https://api.moonshot.ai/v1" },
            modelKwargs: { thinking: { type: "disabled" } },
          });
          this.models.set(key, model);
          break;
        }
        default:
          throw new Error(`Unknown AI provider: ${provider}`);
      }
    }

    return this.models.get(key)!;
  }
}
