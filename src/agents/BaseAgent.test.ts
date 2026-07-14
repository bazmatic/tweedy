import { describe, expect, it, vi } from "vitest";
import { normalizeStopReason, BaseAgent } from "./BaseAgent";
import { AiModelFactory } from "../providers/AiModelFactory";
import { ModelTask } from "../providers/ModelRoutingPolicy";
import { appConfig } from "../utils/config";

class TestAgent extends BaseAgent {
  callModelWithTools(...args: Parameters<BaseAgent["callModelWithTools"]>) {
    return super.callModelWithTools(...args);
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
