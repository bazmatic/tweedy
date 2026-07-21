import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { TranscriptionProviderFactory } from "./TranscriptionProviderFactory";
import { TranscriptionProviderName } from "../types";
import { OpenAIWhisperProvider } from "./OpenAIWhisperProvider";

describe("TranscriptionProviderFactory", () => {
  const originalKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalKey;
  });

  it("resolves the OpenAI Whisper provider", () => {
    const provider = TranscriptionProviderFactory.getProvider(
      TranscriptionProviderName.OpenAIWhisper
    );
    expect(provider).toBeInstanceOf(OpenAIWhisperProvider);
  });

  it("throws on an unknown provider name", () => {
    expect(() =>
      TranscriptionProviderFactory.getProvider("nonexistent" as TranscriptionProviderName)
    ).toThrow("Unknown transcription provider");
  });
});
