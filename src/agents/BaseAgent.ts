import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { z } from "zod";
import { jsonrepair } from "jsonrepair";
import { AiModelFactory } from "../providers/AiModelFactory";
import { ModelTask } from "../providers/ModelRoutingPolicy";
import { StructuredOutputMethodPolicy } from "../providers/StructuredOutputMethodPolicy";
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

const PARSER_EXCEPTION_PATTERN =
  /^Function "([^"]*)" arguments:\n\n([\s\S]*)\n\nare not valid JSON\./;

/**
 * When arguments are cut off mid-generation (hit the token limit) rather
 * than merely malformed, the JSON is genuinely incomplete — there's no
 * escaping fix for an unterminated string. Instead, walk the text tracking
 * bracket nesting and find the last point where a complete element closed
 * immediately inside an array (i.e. the last fully-generated array item),
 * truncate there, and close out whatever containers were still open at that
 * point. This discards only the one dangling, half-written element.
 */
function repairTruncatedJsonArray(raw: string): string | undefined {
  const stack: string[] = [];
  let inString = false;
  let lastSafeIndex = -1;
  let lastSafeStack: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      stack.push(ch);
      continue;
    }
    if (ch === "}" || ch === "]") {
      stack.pop();
      if (stack[stack.length - 1] === "[") {
        lastSafeIndex = i;
        lastSafeStack = [...stack];
      }
    }
  }
  if (lastSafeIndex === -1) return undefined;
  let repaired = raw.slice(0, lastSafeIndex + 1);
  for (let i = lastSafeStack.length - 1; i >= 0; i--) {
    repaired += lastSafeStack[i] === "[" ? "]" : "}";
  }
  return repaired;
}

/**
 * Occasionally a model drops the quoting/bracketing for a string or
 * string-array field entirely and writes the value as bare, unquoted prose
 * (sometimes containing its own literal quote marks), e.g.
 * `"feedback": Ada's role is expert, but she says "I love this"., "revisedMessages": ...}`.
 * That isn't recoverable by escaping — the value was never delimited in the
 * first place. Walk the schema's own field list (known field names bound
 * this correctly, since the model can't invent a field name that isn't in
 * the tool's schema) to find each string/string-array field's raw span in
 * the text, and if it wasn't properly quoted/bracketed, wrap the raw text
 * as a JSON string (re-escaping anything inside it) ourselves.
 */
function coerceUnquotedScalarFields(raw: string, schema: z.ZodTypeAny): string {
  if (!(schema instanceof z.ZodObject)) return raw;
  const shape = schema.shape as Record<string, z.ZodTypeAny>;
  const fieldNames = Object.keys(shape);
  let result = raw;
  for (let idx = 0; idx < fieldNames.length; idx++) {
    const field = fieldNames[idx];
    const def = shape[field];
    const isString = def instanceof z.ZodString;
    const isStringArray =
      def instanceof z.ZodArray && def.element instanceof z.ZodString;
    if (!isString && !isStringArray) continue;

    const marker = `"${field}"`;
    const markerIndex = result.indexOf(marker);
    if (markerIndex === -1) continue;
    const colonIndex = result.indexOf(":", markerIndex + marker.length);
    if (colonIndex === -1) continue;
    let valueStart = colonIndex + 1;
    while (
      result[valueStart] === " " ||
      result[valueStart] === "\n" ||
      result[valueStart] === "\t"
    )
      valueStart++;

    const firstChar = result[valueStart];
    if (firstChar === '"' || (isStringArray && firstChar === "[")) continue;

    let valueEnd = result.length;
    for (let j = idx + 1; j < fieldNames.length; j++) {
      const nextMarker = `"${fieldNames[j]}"`;
      const nextIndex = result.indexOf(nextMarker, valueStart);
      if (nextIndex !== -1) {
        const commaIndex = result.lastIndexOf(",", nextIndex);
        valueEnd =
          commaIndex !== -1 && commaIndex >= valueStart
            ? commaIndex
            : nextIndex;
        break;
      }
    }
    if (valueEnd === result.length) {
      const lastBrace = result.lastIndexOf("}");
      if (lastBrace !== -1 && lastBrace > valueStart) valueEnd = lastBrace;
    }

    const rawValue = result.slice(valueStart, valueEnd).trim();
    if (!rawValue) continue;
    const replacement = isStringArray
      ? `[${JSON.stringify(rawValue)}]`
      : JSON.stringify(rawValue);
    result = result.slice(0, valueStart) + replacement + result.slice(valueEnd);
  }
  return result;
}

/**
 * LangChain's tool-call JSON parser embeds the raw (invalid) arguments text
 * directly in its thrown error message rather than exposing it as a
 * structured field. Recover it so we can repair and re-parse instead of
 * discarding an otherwise-good response and burning a retry attempt.
 *
 * Most malformations (raw control characters, invalid escape sequences, and
 * plenty of shapes we haven't hit yet) are generic JSON syntax problems, so
 * delegate those to `jsonrepair` rather than hand-rolling a parser per shape.
 * Only two things need schema awareness that a generic repair can't have:
 * a value written with no quoting/bracketing at all (needs the field's
 * expected type to know how to re-wrap it), and a token-limit truncation
 * where the right fix is to drop the dangling incomplete element rather
 * than pad it out with placeholder fields.
 */
function recoverFromJsonParseFailure<T>(
  error: unknown,
  schema: z.ZodType<T, z.ZodTypeDef, any>
): T | undefined {
  if (!(error instanceof Error)) return undefined;
  const match = error.message.match(PARSER_EXCEPTION_PATTERN);
  if (!match) return undefined;

  const coerced = coerceUnquotedScalarFields(match[2], schema);
  const tryParse = (text: string): T | undefined => {
    try {
      return schema.parse(JSON.parse(jsonrepair(text)));
    } catch {
      return undefined;
    }
  };

  const direct = tryParse(coerced);
  if (direct !== undefined) return direct;

  const truncationRepaired = repairTruncatedJsonArray(coerced);
  return truncationRepaired ? tryParse(truncationRepaired) : undefined;
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

const TRUNCATION_FILLER_WORDS = [
  "um",
  "uh",
  "so",
];

export function appendTruncationFiller(message: string): string {
  const filler =
    TRUNCATION_FILLER_WORDS[
      Math.floor(Math.random() * TRUNCATION_FILLER_WORDS.length)
    ];
  return `${message.trimEnd()}... ${filler}`;
}

const MAX_TOKENS_REASONS = new Set(["max_tokens", "length"]);
const TOOL_USE_REASONS = new Set(["tool_use", "tool_calls"]);
const STOP_REASONS = new Set(["end_turn", "stop_sequence", "stop"]);
const structuredOutputMethodPolicy = new StructuredOutputMethodPolicy();

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
    task: ModelTask,
    messages: LlmMessage[],
    maxTokens: number = 200
  ): Promise<string> {
    try {
      const model = AiModelFactory.getModel(
        appConfig.defaultAiProvider,
        task,
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
    task: ModelTask,
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
        task,
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

  protected async callModelForStructuredOutput<
    T extends Record<string, unknown>
  >(
    task: ModelTask,
    messages: LlmMessage[],
    schema: z.ZodType<T, z.ZodTypeDef, any>,
    maxTokens: number = 200
  ): Promise<T> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const model = AiModelFactory.getModel(
          appConfig.defaultAiProvider,
          task,
          maxTokens
        );
        const result = await model
          .withStructuredOutput<T>(schema, {
            method: structuredOutputMethodPolicy.resolve(
              appConfig.defaultAiProvider
            ),
          })
          .invoke(toBaseMessages(messages));
        if (result === undefined) {
          // The LangChain tool-call parser silently resolves to undefined
          // (rather than throwing) when the model made zero matching tool
          // calls — surface that as a real error instead of letting callers
          // crash on an unexpected undefined.
          throw new Error(
            `AI model for task "${task}" did not produce the required tool call`
          );
        }
        return result;
      } catch (error) {
        const recovered = recoverFromJsonParseFailure(error, schema);
        if (recovered !== undefined) {
          logger.warn(
            "AI model structured-output arguments were malformed JSON; repaired and recovered instead of retrying"
          );
          return recovered;
        }
        logger.error(
          `AI model structured-output call failed (attempt ${attempt}/${maxAttempts}):`,
          error
        );
        if (attempt === maxAttempts) {
          throw error;
        }
        // This call is observably flaky — the model occasionally returns zero
        // tool calls with no other signal — so a short backoff-and-retry here
        // saves the many turns of already-completed script generation that
        // would otherwise be discarded on a single bad response.
        await new Promise((resolve) =>
          setTimeout(resolve, attempt * 1000)
        );
      }
    }
    // Unreachable: the loop always returns or throws on its final attempt.
    throw new Error(`AI model for task "${task}" failed after retries`);
  }

  protected logAgentAction(action: string, details?: any): void {
    logger.debug(`Agent action: ${action}`, details);
  }
}
