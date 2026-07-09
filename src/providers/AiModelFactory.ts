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
          const model = new ChatAnthropic({
            apiKey,
            model: "claude-sonnet-4-5",
            maxTokens,
          });
          // @langchain/anthropic@0.2.x defaults topP/topK to a -1 sentinel and
          // always sends it, which claude-sonnet-4-5 rejects ("top_p cannot be
          // set to -1"). There's no constructor option to omit them (the ??
          // fallback treats both null and undefined as "use the -1 default"),
          // so clear them on the instance directly — JSON.stringify then drops
          // the undefined fields, matching the original SDK calls that never
          // sent top_p/top_k at all. Fixed upstream in @langchain/anthropic@0.3.20+,
          // which requires a @langchain/core bump this project isn't taking yet.
          (model as unknown as { topP?: number; topK?: number }).topP =
            undefined;
          (model as unknown as { topP?: number; topK?: number }).topK =
            undefined;
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
