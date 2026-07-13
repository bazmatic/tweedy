import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
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
          // @langchain/anthropic@0.2.x defaults topP/topK to a -1 sentinel and
          // always sends it, which claude-sonnet-4-5 rejects ("top_p cannot be
          // set to -1"). Passing a valid topP instead conflicts with the
          // also-always-sent temperature default ("temperature and top_p
          // cannot both be specified"). invocationKwargs is spread into the
          // request after top_p/top_k are set, so overriding them there to
          // undefined drops both from the serialized request, matching the
          // original SDK calls that never sent either param. Fixed upstream
          // in @langchain/anthropic@0.3.20+, which requires a @langchain/core
          // bump this project isn't taking yet.
          const model = new ChatAnthropic({
            apiKey,
            model: "claude-sonnet-4-5",
            maxTokens,
            invocationKwargs: { top_p: undefined, top_k: undefined },
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
            model: "deepseek-v4-flash",
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
