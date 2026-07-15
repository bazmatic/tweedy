import { describe, expect, it, vi } from "vitest";
import { normalizeStopReason, BaseAgent } from "./BaseAgent";
import { AiModelFactory } from "../providers/AiModelFactory";
import { ModelTask } from "../providers/ModelRoutingPolicy";
import { appConfig } from "../utils/config";
import { z } from "zod";
import { StructuredOutputMethod } from "../providers/StructuredOutputMethodPolicy";
import { AiProviderName, LlmMessage } from "../types";

class TestAgent extends BaseAgent {
  callModelWithTools(...args: Parameters<BaseAgent["callModelWithTools"]>) {
    return super.callModelWithTools(...args);
  }

  callModelForStructuredOutput<T extends Record<string, unknown>>(
    task: ModelTask,
    messages: LlmMessage[],
    schema: z.ZodType<T>,
    maxTokens?: number
  ): Promise<T> {
    return super.callModelForStructuredOutput(
      task,
      messages,
      schema,
      maxTokens
    );
  }
}

describe("normalizeStopReason", () => {
  it("maps Anthropic's max_tokens stop_reason to max_tokens", () => {
    expect(normalizeStopReason({ stop_reason: "max_tokens" })).toBe(
      "max_tokens"
    );
  });

  it("maps Anthropic's tool_use stop_reason to tool_use", () => {
    expect(normalizeStopReason({ stop_reason: "tool_use" })).toBe("tool_use");
  });

  it("maps Anthropic's end_turn and stop_sequence to stop", () => {
    expect(normalizeStopReason({ stop_reason: "end_turn" })).toBe("stop");
    expect(normalizeStopReason({ stop_reason: "stop_sequence" })).toBe(
      "stop"
    );
  });

  it("maps OpenAI-compatible length finish_reason to max_tokens", () => {
    expect(normalizeStopReason({ finish_reason: "length" })).toBe(
      "max_tokens"
    );
  });

  it("maps OpenAI-compatible tool_calls finish_reason to tool_use", () => {
    expect(normalizeStopReason({ finish_reason: "tool_calls" })).toBe(
      "tool_use"
    );
  });

  it("maps OpenAI-compatible stop finish_reason to stop", () => {
    expect(normalizeStopReason({ finish_reason: "stop" })).toBe("stop");
  });

  it("returns unknown for unrecognized or missing metadata", () => {
    expect(normalizeStopReason({ stop_reason: "content_filter" })).toBe(
      "unknown"
    );
    expect(normalizeStopReason(undefined)).toBe("unknown");
    expect(normalizeStopReason({})).toBe("unknown");
  });
});

describe("callModelWithTools truncation filler", () => {
  it("appends filler even when the tool call parses cleanly but finish_reason is max_tokens", async () => {
    const fakeModel = {
      bindTools: () => ({
        invoke: async () => ({
          tool_calls: [
            {
              name: "SPEAK",
              args: { message: "how did they not just suffocate?", style: "urgent" },
            },
          ],
          response_metadata: { finish_reason: "length" },
        }),
      }),
    };
    const getModel = vi
      .spyOn(AiModelFactory, "getModel")
      .mockReturnValue(fakeModel as any);

    const agent = new TestAgent();
    const result = await agent.callModelWithTools(
      ModelTask.SpeechGeneration,
      [{ role: "user", content: "go" }],
      [],
      200
    );

    expect(result.stopReason).toBe("max_tokens");
    expect(result.message).not.toBe("how did they not just suffocate?");
    expect(result.message.startsWith("how did they not just suffocate?")).toBe(
      true
    );
    expect(getModel).toHaveBeenCalledWith(
      appConfig.defaultAiProvider,
      ModelTask.SpeechGeneration,
      200
    );
  });

  it("reports a malformed tool call instead of dereferencing a missing message", async () => {
    const fakeModel = {
      bindTools: () => ({
        invoke: async () => ({
          tool_calls: [
            {
              name: "SPEAK",
              args: { style: "thoughtful" },
            },
          ],
          response_metadata: { finish_reason: "length" },
        }),
      }),
    };
    vi.spyOn(AiModelFactory, "getModel").mockReturnValue(fakeModel as any);

    const agent = new TestAgent();

    await expect(
      agent.callModelWithTools(
        ModelTask.SpeechGeneration,
        [{ role: "user", content: "go" }],
        [],
        200
      )
    ).rejects.toThrow("AI model tool call omitted a spoken message");
  });
});

describe("callModelForStructuredOutput", () => {
  it("uses LangChain structured output and returns the validated result", async () => {
    const schema = z.object({ isComplete: z.boolean() });
    const invoke = vi.fn().mockResolvedValue({ isComplete: true });
    const withStructuredOutput = vi.fn().mockReturnValue({ invoke });
    vi.spyOn(AiModelFactory, "getModel").mockReturnValue({
      withStructuredOutput,
    } as any);

    const result = await new TestAgent().callModelForStructuredOutput(
      ModelTask.ConclusionCheck,
      [{ role: "user", content: "Has the episode finished?" }],
      schema,
      50
    );

    expect(withStructuredOutput).toHaveBeenCalledWith(schema, {
      method:
        appConfig.defaultAiProvider === AiProviderName.Anthropic
          ? StructuredOutputMethod.JsonSchema
          : StructuredOutputMethod.FunctionCalling,
    });
    expect(invoke).toHaveBeenCalledOnce();
    expect(result).toEqual({ isComplete: true });
  });

  it("recovers from a raw unescaped control character in tool-call arguments instead of retrying", async () => {
    const schema = z.object({
      accepted: z.boolean(),
      revisedMessages: z.array(z.string()),
    });
    const rawArgs = JSON.stringify({
      accepted: false,
      revisedMessages: ["first paragraph\nsecond paragraph"],
    })
      // Simulate DeepSeek emitting a literal newline instead of an escaped
      // \n inside the string value.
      .replace("first paragraph\\nsecond paragraph", "first paragraph\nsecond paragraph");
    const parseError = new Error(
      [
        `Function "extract" arguments:`,
        ``,
        rawArgs,
        ``,
        `are not valid JSON.`,
        `Error: Bad control character in string literal in JSON at position 42`,
      ].join("\n")
    );
    const invoke = vi.fn().mockRejectedValue(parseError);
    const withStructuredOutput = vi.fn().mockReturnValue({ invoke });
    vi.spyOn(AiModelFactory, "getModel").mockReturnValue({
      withStructuredOutput,
    } as any);

    const result = await new TestAgent().callModelForStructuredOutput(
      ModelTask.TurnReview,
      [{ role: "user", content: "Review this turn" }],
      schema,
      50
    );

    expect(invoke).toHaveBeenCalledOnce();
    expect(result).toEqual({
      accepted: false,
      revisedMessages: ["first paragraph\nsecond paragraph"],
    });
  });

  it("recovers from an invalid LaTeX-style escape sequence in tool-call arguments", async () => {
    const schema = z.object({
      synopsis: z.string(),
    });
    // A literal `\(` copied verbatim from source material — not a legal
    // JSON escape (JSON.stringify would never produce it, but the model did).
    const rawArgs = `{"synopsis": "we convert the trains \\(T\\) to strings"}`;
    const parseError = new Error(
      [
        `Function "extract" arguments:`,
        ``,
        rawArgs,
        ``,
        `are not valid JSON.`,
        `Error: Bad escaped character in JSON at position 40`,
      ].join("\n")
    );
    const invoke = vi.fn().mockRejectedValue(parseError);
    const withStructuredOutput = vi.fn().mockReturnValue({ invoke });
    vi.spyOn(AiModelFactory, "getModel").mockReturnValue({
      withStructuredOutput,
    } as any);

    const result = await new TestAgent().callModelForStructuredOutput(
      ModelTask.MaterialSummary,
      [{ role: "user", content: "Summarize this material" }],
      schema,
      50
    );

    expect(invoke).toHaveBeenCalledOnce();
    // jsonrepair drops an invalid escape's backslash rather than escaping it,
    // so the literal "\(" collapses to "(" — content changes slightly, but
    // the response survives instead of being discarded entirely.
    expect(result).toEqual({
      synopsis: "we convert the trains (T) to strings",
    });
  });

  it("recovers from a token-limit truncation by dropping the dangling incomplete array element", async () => {
    const schema = z.object({
      synopsis: z.string(),
      cards: z.array(z.object({ content: z.string(), storyValue: z.number() })),
    });
    // The second card is cut off mid-generation (hit the token limit) —
    // the string never closes and the object/array/root braces are missing.
    const rawArgs =
      `{"synopsis": "intro", "cards": [` +
      `{"content": "first card", "storyValue": 7},` +
      `{"content": "second card cut off mid-sentence because tokens ran out`;
    const parseError = new Error(
      [
        `Function "extract" arguments:`,
        ``,
        rawArgs,
        ``,
        `are not valid JSON.`,
        `Error: Unterminated string in JSON at position 999`,
      ].join("\n")
    );
    const invoke = vi.fn().mockRejectedValue(parseError);
    const withStructuredOutput = vi.fn().mockReturnValue({ invoke });
    vi.spyOn(AiModelFactory, "getModel").mockReturnValue({
      withStructuredOutput,
    } as any);

    const result = await new TestAgent().callModelForStructuredOutput(
      ModelTask.MaterialPreparation,
      [{ role: "user", content: "Prepare this material" }],
      schema,
      50
    );

    expect(invoke).toHaveBeenCalledOnce();
    expect(result).toEqual({
      synopsis: "intro",
      cards: [{ content: "first card", storyValue: 7 }],
    });
  });

  it("recovers when a string-array field is written as bare unquoted prose instead of a JSON array", async () => {
    const schema = z.object({
      accepted: z.boolean(),
      feedback: z.array(z.string()).max(1),
      revisedMessages: z.array(z.string()).max(1),
    });
    // The model dropped quoting/bracketing entirely for the last two fields,
    // writing raw prose (including its own literal quote marks) instead.
    const rawArgs =
      `{"accepted": false, "feedback": Ada's role is expert, but she says ` +
      `"I love this."., "revisedMessages": So, the split gill is widespread.}`;
    const parseError = new Error(
      [
        `Function "extract" arguments:`,
        ``,
        rawArgs,
        ``,
        `are not valid JSON.`,
        `Error: Unexpected token 'A', ..."eedback": Ada's role"... is not valid JSON`,
      ].join("\n")
    );
    const invoke = vi.fn().mockRejectedValue(parseError);
    const withStructuredOutput = vi.fn().mockReturnValue({ invoke });
    vi.spyOn(AiModelFactory, "getModel").mockReturnValue({
      withStructuredOutput,
    } as any);

    const result = await new TestAgent().callModelForStructuredOutput(
      ModelTask.TurnReview,
      [{ role: "user", content: "Review this turn" }],
      schema,
      50
    );

    expect(invoke).toHaveBeenCalledOnce();
    expect(result).toEqual({
      accepted: false,
      feedback: [`Ada's role is expert, but she says "I love this.".`],
      revisedMessages: ["So, the split gill is widespread."],
    });
  });
});
