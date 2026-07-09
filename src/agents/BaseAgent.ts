import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { AiModelFactory } from "../providers/AiModelFactory";
import { appConfig } from "../utils/config";
import { LlmMessage, LlmTool } from "../types";
import { logger } from "../utils/logger";

function toBaseMessages(messages: LlmMessage[]): BaseMessage[] {
  return messages.map((message) => {
    switch (message.role) {
      case "assistant":
        return new AIMessage(message.content);
      case "system":
        return new SystemMessage(message.content);
      default:
        return new HumanMessage(message.content);
    }
  });
}

export abstract class BaseAgent {
  protected async callModel(
    messages: LlmMessage[],
    maxTokens: number = 200
  ): Promise<string> {
    try {
      const model = AiModelFactory.getModel(
        appConfig.defaultAiProvider,
        maxTokens
      );
      const response = await model.invoke(toBaseMessages(messages));

      return typeof response.content === "string" ? response.content : "";
    } catch (error) {
      logger.error("AI model call failed:", error);
      throw error;
    }
  }

  protected async callModelWithTools(
    messages: LlmMessage[],
    tools: LlmTool[],
    maxTokens: number = 200
  ): Promise<{ toolName: string; message: string; style: string }> {
    try {
      const model = AiModelFactory.getModel(
        appConfig.defaultAiProvider,
        maxTokens
      );
      const response = (await model
        .bindTools!(tools, { tool_choice: "any" })
        .invoke(toBaseMessages(messages))) as AIMessage;

      const toolCall = response.tool_calls?.[0];
      if (!toolCall) {
        throw new Error("AI model response did not include a tool call");
      }

      const input = toolCall.args as { message: string; style: string };

      return {
        toolName: toolCall.name,
        message: input.message,
        style: input.style,
      };
    } catch (error) {
      logger.error("AI model tool-use call failed:", error);
      throw error;
    }
  }

  protected async callModelForToolInput<T>(
    messages: LlmMessage[],
    tools: LlmTool[],
    maxTokens: number = 200
  ): Promise<T> {
    try {
      const model = AiModelFactory.getModel(
        appConfig.defaultAiProvider,
        maxTokens
      );
      const response = (await model
        .bindTools!(tools, { tool_choice: "any" })
        .invoke(toBaseMessages(messages))) as AIMessage;

      const toolCall = response.tool_calls?.[0];
      if (!toolCall) {
        throw new Error("AI model response did not include a tool call");
      }

      return toolCall.args as T;
    } catch (error) {
      logger.error("AI model tool-use call failed:", error);
      throw error;
    }
  }

  protected logAgentAction(action: string, details?: any): void {
    logger.debug(`Agent action: ${action}`, details);
  }
}
