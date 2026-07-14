import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { AiModelFactory } from "../providers/AiModelFactory";
import { appConfig } from "../utils/config";
import { LlmMessage, LlmTool, StopReason } from "../types";
import { logger } from "../utils/logger";

function toOpenAiTools(tools: LlmTool[]) {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

function unescapeJsonString(value: string): string {
  return value.replace(/\\(["\\/bfnrt]|u[0-9a-fA-F]{4})/g, (match, esc) => {
    switch (esc[0]) {
      case '"':
        return '"';
      case "\\":
        return "\\";
      case "/":
        return "/";
      case "b":
        return "\b";
      case "f":
        return "\f";
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "u":
        return String.fromCharCode(parseInt(esc.slice(1), 16));
      default:
        return match;
    }
  });
}

/**
 * Pulls a string field's value out of a (possibly incomplete) JSON object,
 * even if the value's closing quote was never emitted because generation
 * stopped mid-string. Returns the field's contents up to wherever it was cut off.
 */
function extractPartialStringField(
  raw: string,
  field: string
): string | undefined {
  const marker = `"${field}"`;
  const markerIndex = raw.indexOf(marker);
  if (markerIndex === -1) return undefined;

  const colonIndex = raw.indexOf(":", markerIndex + marker.length);
  if (colonIndex === -1) return undefined;

  let i = colonIndex + 1;
  while (raw[i] === " " || raw[i] === "\n" || raw[i] === "\t") i++;
  if (raw[i] !== '"') return undefined;
  i++;

  let value = "";
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === "\\") {
      value += ch + (raw[i + 1] ?? "");
      i += 2;
      continue;
    }
    if (ch === '"') {
      return unescapeJsonString(value);
    }
    value += ch;
    i++;
  }

  // Ran off the end without a closing quote: the field was mid-generation
  // when the model hit its token cap. Return what was produced so far.
  return unescapeJsonString(value);
}

/**
 * When a tool-call response is cut off by the token limit, LangChain can't
 * parse the (invalid, unterminated) JSON arguments into `tool_calls`, so a
 * long-running turn would otherwise hard-fail and retry from scratch. Recover
 * whatever content was actually generated instead of discarding it.
 */
function recoverTruncatedToolCall(
  response: AIMessage
): { toolName: string; message: string; style: string } | null {
  const rawCall = (response.additional_kwargs?.tool_calls as any[] | undefined)?.[0];
  const toolName = rawCall?.function?.name;
  const args = rawCall?.function?.arguments;
  if (!toolName || typeof args !== "string") return null;

  const message = extractPartialStringField(args, "message");
  if (!message) return null;

  return {
    toolName,
    message,
    style: extractPartialStringField(args, "style") ?? "",
  };
}

/**
 * Best-effort repair of a JSON object that was cut off mid-generation by the
 * token limit: closes any still-open string, drops a dangling trailing comma,
 * then closes any still-open objects/arrays in the correct order.
 */
function repairTruncatedJson(raw: string): unknown | null {
  let inString = false;
  let escape = false;
  const stack: string[] = [];

  for (const ch of raw) {
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{" || ch === "[") {
      stack.push(ch);
    } else if (ch === "}" || ch === "]") {
      stack.pop();
    }
  }

  let repaired = raw;
  if (inString) repaired += '"';
  repaired = repaired.replace(/,\s*$/, "");
  for (let i = stack.length - 1; i >= 0; i--) {
    repaired += stack[i] === "{" ? "}" : "]";
  }

  try {
    return JSON.parse(repaired);
  } catch {
    return null;
  }
}

/**
 * When a forced tool call is cut off by the token limit, LangChain can't parse
 * the (invalid, unterminated) JSON arguments and leaves `tool_calls` empty, so
 * a long-running turn would otherwise hard-fail. Recover whatever structured
 * data was actually generated instead of discarding it.
 */
function recoverTruncatedToolInput<T>(response: AIMessage): T | null {
  const rawCall = (response.additional_kwargs?.tool_calls as any[] | undefined)?.[0];
  const args = rawCall?.function?.arguments;
  if (typeof args !== "string") return null;

  const repaired = repairTruncatedJson(args);
  return repaired === null ? null : (repaired as T);
}

const TRUNCATION_FILLER_WORDS = [
  "um",
  "uh",
  "so",
];

function appendTruncationFiller(message: string): string {
  const filler =
    TRUNCATION_FILLER_WORDS[
      Math.floor(Math.random() * TRUNCATION_FILLER_WORDS.length)
    ];
  return `${message.trimEnd()}... ${filler}`;
}

const MAX_TOKENS_REASONS = new Set(["max_tokens", "length"]);
const TOOL_USE_REASONS = new Set(["tool_use", "tool_calls"]);
const STOP_REASONS = new Set(["end_turn", "stop_sequence", "stop"]);

export function normalizeStopReason(
  metadata: Record<string, unknown> | undefined
): StopReason {
  const raw = (metadata?.stop_reason ?? metadata?.finish_reason) as
    | string
    | undefined;
  if (!raw) return "unknown";
  if (MAX_TOKENS_REASONS.has(raw)) return "max_tokens";
  if (TOOL_USE_REASONS.has(raw)) return "tool_use";
  if (STOP_REASONS.has(raw)) return "stop";
  return "unknown";
}

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
  ): Promise<{
    toolName: string;
    message: string;
    style: string;
    stopReason: StopReason;
  }> {
    try {
      const model = AiModelFactory.getModel(
        appConfig.defaultAiProvider,
        maxTokens
      );
      const response = (await model
        .bindTools!(toOpenAiTools(tools), { tool_choice: "any" })
        .invoke(toBaseMessages(messages))) as AIMessage;

      const toolCall = response.tool_calls?.[0];
      if (!toolCall) {
        const recovered = recoverTruncatedToolCall(response);
        if (recovered) {
          logger.warn(
            "Tool call truncated by the token limit; using the partial response instead of retrying"
          );
          return {
            ...recovered,
            message: appendTruncationFiller(recovered.message),
            stopReason: "max_tokens",
          };
        }
        throw new Error("AI model response did not include a tool call");
      }

      const input = toolCall.args as { message?: unknown; style?: unknown };
      const stopReason = normalizeStopReason(response.response_metadata);
      if (
        typeof input.message !== "string" ||
        input.message.trim().length === 0
      ) {
        throw new Error("AI model tool call omitted a spoken message");
      }

      return {
        toolName: toolCall.name,
        message:
          stopReason === "max_tokens"
            ? appendTruncationFiller(input.message)
            : input.message,
        style: typeof input.style === "string" ? input.style : "",
        stopReason,
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
        .bindTools!(toOpenAiTools(tools), { tool_choice: "any" })
        .invoke(toBaseMessages(messages))) as AIMessage;

      const toolCall = response.tool_calls?.[0];
      if (!toolCall) {
        const recovered = recoverTruncatedToolInput<T>(response);
        if (recovered) {
          logger.warn(
            "Tool call truncated by the token limit; using the repaired partial response instead of retrying"
          );
          return recovered;
        }
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
