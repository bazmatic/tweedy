import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatAnthropic } from "@langchain/anthropic";
import { AiProviderName } from "../types";

export class AiModelFactory {
  private static models: Map<string, BaseChatModel> = new Map();

  static getModel(provider: AiProviderName, maxTokens: number): BaseChatModel {
    const key = `${provider}:${maxTokens}`;

    if (!this.models.has(key)) {
      switch (provider) {
        case AiProviderName.Anthropic: {
          const apiKey = process.env.ANTHROPIC_API_KEY;
          if (!apiKey) {
            throw new Error(
              "ANTHROPIC_API_KEY environment variable is required"
            );
          }
          this.models.set(
            key,
            new ChatAnthropic({
              apiKey,
              model: "claude-sonnet-4-5",
              maxTokens,
            })
          );
          break;
        }
        default:
          throw new Error(`Unknown AI provider: ${provider}`);
      }
    }

    return this.models.get(key)!;
  }
}
