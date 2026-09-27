import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { chatOpenAIMock } = vi.hoisted(() => ({ chatOpenAIMock: vi.fn() }));

vi.mock("@langchain/openai", () => ({
  ChatOpenAI: chatOpenAIMock,
}));
vi.mock("@langchain/anthropic", () => ({
  ChatAnthropic: vi.fn(),
}));

import { AiModelFactory } from "./AiModelFactory";
import { AiProviderName } from "../types";
import { ModelTask } from "./ModelRoutingPolicy";

describe("AiModelFactory Kimi token budget", () => {
  const originalKey = process.env.MOONSHOT_API_KEY;

  beforeEach(() => {
    process.env.MOONSHOT_API_KEY = "test-key";
    chatOpenAIMock.mockClear();
  });

  afterEach(() => {
    process.env.MOONSHOT_API_KEY = originalKey;
  });

  it("gives Kimi the same kind of headroom above the visible-output budget that DeepSeek gets", () => {
    // A maxTokens value unlikely to collide with the factory's model cache
    // across other tests/runs.
    AiModelFactory.getModel(AiProviderName.Kimi, ModelTask.SpeechGeneration, 313);

    expect(chatOpenAIMock).toHaveBeenCalledWith(
      expect.objectContaining({ maxTokens: expect.any(Number) })
    );
    const passedMaxTokens = chatOpenAIMock.mock.calls[0][0].maxTokens;
    expect(passedMaxTokens).toBeGreaterThan(313);
  });
});
