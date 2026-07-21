import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const mockCreate = vi.fn();

vi.mock("openai", () => ({
  default: class {
    audio = { transcriptions: { create: mockCreate } };
  },
}));

vi.mock("fs-extra", () => ({
  createReadStream: vi.fn(() => "fake-stream"),
}));

import { OpenAIWhisperProvider } from "./OpenAIWhisperProvider";

describe("OpenAIWhisperProvider", () => {
  const originalKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    mockCreate.mockReset();
  });

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalKey;
  });

  it("throws if OPENAI_API_KEY is missing", () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => new OpenAIWhisperProvider()).toThrow("OPENAI_API_KEY");
  });

  it("maps the Whisper verbose_json word list into WordTimestamp[]", async () => {
    mockCreate.mockResolvedValue({
      duration: 2,
      language: "en",
      text: "hello there",
      words: [
        { word: "hello", start: 0.1, end: 0.4 },
        { word: "there", start: 0.4, end: 0.8 },
      ],
    });

    const provider = new OpenAIWhisperProvider();
    const result = await provider.transcribe("/tmp/fake.mp3");

    expect(result.words).toEqual([
      { word: "hello", startSeconds: 0.1, endSeconds: 0.4 },
      { word: "there", startSeconds: 0.4, endSeconds: 0.8 },
    ]);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "whisper-1",
        response_format: "verbose_json",
        timestamp_granularities: ["word"],
      })
    );
  });

  it("returns an empty array if the API returns no words", async () => {
    mockCreate.mockResolvedValue({ duration: 1, language: "en", text: "" });

    const provider = new OpenAIWhisperProvider();
    const result = await provider.transcribe("/tmp/fake.mp3");

    expect(result.words).toEqual([]);
  });
});
