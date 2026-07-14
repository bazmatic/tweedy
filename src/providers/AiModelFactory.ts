import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { AiProviderName } from "../types";
import { ModelRoutingPolicy, ModelTask } from "./ModelRoutingPolicy";
import { ProviderModelCatalogue } from "./ProviderModelCatalogue";

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
    const key = `${provider}:${modelId}:${maxTokens}`;

    if (!this.models.has(key)) {
      switch (provider) {
        case AiProviderName.Anthropic: {
          const apiKey = process.env.ANTHROPIC_API_KEY;
          if (!apiKey) {
            throw new Error(
              "ANTHROPIC_API_KEY environment variable is required"
            );
          }
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
            maxTokens,
            configuration: { baseURL: "https://api.deepseek.com" },
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
