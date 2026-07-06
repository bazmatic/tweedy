import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../utils/logger";

export abstract class BaseAgent {
  protected client: Anthropic;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY environment variable is required");
    }
    this.client = new Anthropic({ apiKey });
  }

  protected async callClaude(
    messages: any[],
    maxTokens: number = 200
  ): Promise<string> {
    try {
      const response = await this.client.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: maxTokens,
        messages,
      });

      return response.content[0].type === "text"
        ? response.content[0].text
        : "";
    } catch (error) {
      logger.error("Claude API call failed:", error);
      throw error;
    }
  }

  protected async callClaudeWithTools(
    messages: Anthropic.MessageParam[],
    tools: Anthropic.Tool[],
    maxTokens: number = 200
  ): Promise<{ toolName: string; message: string; style: string }> {
    try {
      const response = await this.client.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: maxTokens,
        messages,
        tools,
        tool_choice: { type: "any" },
      });

      const toolUseBlock = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
      );

      if (!toolUseBlock) {
        throw new Error("Claude response did not include a tool_use block");
      }

      const input = toolUseBlock.input as { message: string; style: string };

      return {
        toolName: toolUseBlock.name,
        message: input.message,
        style: input.style,
      };
    } catch (error) {
      logger.error("Claude tool-use API call failed:", error);
      throw error;
    }
  }

  protected async callClaudeForToolInput<T>(
    messages: Anthropic.MessageParam[],
    tools: Anthropic.Tool[],
    maxTokens: number = 200
  ): Promise<T> {
    try {
      const response = await this.client.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: maxTokens,
        messages,
        tools,
        tool_choice: { type: "any" },
      });

      const toolUseBlock = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
      );

      if (!toolUseBlock) {
        throw new Error("Claude response did not include a tool_use block");
      }

      return toolUseBlock.input as T;
    } catch (error) {
      logger.error("Claude tool-use API call failed:", error);
      throw error;
    }
  }

  protected logAgentAction(action: string, details?: any): void {
    logger.debug(`Agent action: ${action}`, details);
  }
}
