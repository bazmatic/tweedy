import { describe, expect, it } from "vitest";
import { normalizeStopReason } from "./BaseAgent";

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
