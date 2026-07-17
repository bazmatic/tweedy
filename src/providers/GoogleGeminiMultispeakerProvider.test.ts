import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";
import * as fs from "fs-extra";
import { GoogleGeminiMultispeakerProvider } from "./GoogleGeminiMultispeakerProvider";
import { VocalProviderName } from "../types";
import type { MultispeakerTurn } from "../types";
import { AiModelFactory } from "./AiModelFactory";

vi.mock("axios");
vi.mock("fs-extra", () => ({
  ensureDir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

const getAccessTokenMock = vi.fn().mockResolvedValue({ token: "test-access-token" });
vi.mock("google-auth-library", () => ({
  GoogleAuth: vi.fn().mockImplementation(function (this: any) {
    this.getClient = vi.fn().mockResolvedValue({ getAccessToken: getAccessTokenMock });
  }),
}));

vi.mock("./AiModelFactory", () => ({
  AiModelFactory: { getModel: vi.fn() },
}));

function makeTurn(speakerId: string, voiceProviderId: string, text: string): MultispeakerTurn {
  return {
    speaker: { id: speakerId, slug: speakerId, name: speakerId } as any,
    voice: {
      id: voiceProviderId,
      name: voiceProviderId,
      description: "",
      provider: VocalProviderName.GoogleGeminiMultispeaker,
      providerId: voiceProviderId,
      settings: {},
    },
    text,
  };
}

describe("GoogleGeminiMultispeakerProvider", () => {
  const originalCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  beforeEach(() => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/tmp/fake-service-account.json";
    vi.clearAllMocks();
    getAccessTokenMock.mockResolvedValue({ token: "test-access-token" });
    (AiModelFactory.getModel as any).mockReturnValue({
      invoke: vi.fn().mockResolvedValue({ content: "" }),
    });
  });

  afterEach(() => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = originalCreds;
  });

  it("throws if GOOGLE_APPLICATION_CREDENTIALS is missing", () => {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    expect(() => new GoogleGeminiMultispeakerProvider()).toThrow(
      "GOOGLE_APPLICATION_CREDENTIALS environment variable is required"
    );
  });

  it("defaults maxTurnsPerChunk to 8", () => {
    const provider = new GoogleGeminiMultispeakerProvider();
    expect(provider.maxTurnsPerChunk).toBe(8);
  });

  it("declares a maxBytesPerChunk under Google's documented 4000-byte input.text limit", () => {
    const provider = new GoogleGeminiMultispeakerProvider();
    expect(provider.maxBytesPerChunk).toBeLessThan(4000);
    expect(provider.maxBytesPerChunk).toBe(3600);
  });

  it("posts turns as aliased speaker lines and writes the decoded audio to disk", async () => {
    const audioB64 = Buffer.from("audio-bytes").toString("base64");
    (axios.post as any).mockResolvedValue({ data: { audioContent: audioB64 } });

    const provider = new GoogleGeminiMultispeakerProvider();
    const turns = [
      makeTurn("sp1", "Puck", "Hello there."),
      makeTurn("sp2", "Kore", "Hi, Ada."),
      makeTurn("sp1", "Puck", "How are you?"),
    ];

    const result = await provider.synthesizeChunk(turns, "chunks/s1.mp3");

    expect(axios.post).toHaveBeenCalledWith(
      "https://texttospeech.googleapis.com/v1/text:synthesize",
      {
        input: { text: "Speaker1: Hello there.\nSpeaker2: Hi, Ada.\nSpeaker1: How are you?" },
        voice: {
          languageCode: "en-US",
          modelName: "gemini-2.5-flash-tts",
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: [
              { speakerAlias: "Speaker1", speakerId: "Puck" },
              { speakerAlias: "Speaker2", speakerId: "Kore" },
            ],
          },
        },
        audioConfig: { audioEncoding: "MP3" },
      },
      { headers: { Authorization: "Bearer test-access-token", "Content-Type": "application/json" } }
    );
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("chunks/s1.mp3"),
      Buffer.from(audioB64, "base64")
    );
    expect(result.outputPath).toContain("chunks/s1.mp3");
  });

  it("strips markdown emphasis asterisks from turn text so Gemini doesn't read them aloud as \"asterisk\"", async () => {
    const audioB64 = Buffer.from("audio-bytes").toString("base64");
    (axios.post as any).mockResolvedValue({ data: { audioContent: audioB64 } });

    const provider = new GoogleGeminiMultispeakerProvider();
    const turns = [
      makeTurn("sp1", "Puck", "It's called *Omphalotus nidiformis*, the ghost fungus."),
      makeTurn("sp2", "Kore", "That's a **great** name."),
    ];

    await provider.synthesizeChunk(turns, "chunks/asterisk.mp3");

    expect(axios.post).toHaveBeenCalledWith(
      "https://texttospeech.googleapis.com/v1/text:synthesize",
      expect.objectContaining({
        input: {
          text: "Speaker1: It's called Omphalotus nidiformis, the ghost fungus.\nSpeaker2: That's a great name.",
        },
      }),
      expect.any(Object)
    );
  });

  it("strips markdown emphasis asterisks in single-voice mode too", async () => {
    const audioB64 = Buffer.from("audio-bytes").toString("base64");
    (axios.post as any).mockResolvedValue({ data: { audioContent: audioB64 } });

    const provider = new GoogleGeminiMultispeakerProvider();
    const turns = [makeTurn("sp1", "Puck", "It's called *Omphalotus nidiformis*.")];

    await provider.synthesizeChunk(turns, "chunks/asterisk-solo.mp3");

    expect(axios.post).toHaveBeenCalledWith(
      "https://texttospeech.googleapis.com/v1/text:synthesize",
      expect.objectContaining({
        input: { text: "It's called Omphalotus nidiformis." },
      }),
      expect.any(Object)
    );
  });

  it("synthesizes a single-speaker chunk (e.g. a solo monologue run) via plain single-voice mode, not multi-speaker", async () => {
    const audioB64 = Buffer.from("audio-bytes").toString("base64");
    (axios.post as any).mockResolvedValue({ data: { audioContent: audioB64 } });

    const provider = new GoogleGeminiMultispeakerProvider();
    const turns = [
      makeTurn("sp1", "Puck", "Part one of a long solo monologue."),
      makeTurn("sp1", "Puck", "Part two, still the same speaker."),
    ];

    const result = await provider.synthesizeChunk(turns, "chunks/solo.mp3");

    expect(axios.post).toHaveBeenCalledWith(
      "https://texttospeech.googleapis.com/v1/text:synthesize",
      {
        input: { text: "Part one of a long solo monologue.\nPart two, still the same speaker." },
        voice: {
          languageCode: "en-US",
          modelName: "gemini-2.5-flash-tts",
          name: "Puck",
        },
        audioConfig: { audioEncoding: "MP3" },
      },
      { headers: { Authorization: "Bearer test-access-token", "Content-Type": "application/json" } }
    );
    expect(result.outputPath).toContain("chunks/solo.mp3");
  });

  it("includes input.prompt with the speaker's voiceStyle in single-voice mode", async () => {
    (axios.post as any).mockResolvedValue({ data: { audioContent: Buffer.from("x").toString("base64") } });

    const provider = new GoogleGeminiMultispeakerProvider();
    const turns = [
      { ...makeTurn("sp1", "Puck", "Solo line."), voiceStyle: "insightful, dry wit" },
    ];

    await provider.synthesizeChunk(turns, "chunks/styled-solo.mp3");

    expect(axios.post).toHaveBeenCalledWith(
      "https://texttospeech.googleapis.com/v1/text:synthesize",
      expect.objectContaining({
        input: { text: "Solo line.", prompt: "insightful, dry wit" },
      }),
      expect.any(Object)
    );
  });

  it("attributes each speaker's voiceStyle to its own alias in input.prompt for multi-speaker mode", async () => {
    (axios.post as any).mockResolvedValue({ data: { audioContent: Buffer.from("x").toString("base64") } });

    const provider = new GoogleGeminiMultispeakerProvider();
    const turns = [
      { ...makeTurn("sp1", "Puck", "Hi."), voiceStyle: "insightful, dry wit" },
      { ...makeTurn("sp2", "Kore", "Hey."), voiceStyle: "warm, enthusiastic, curious" },
    ];

    await provider.synthesizeChunk(turns, "chunks/styled-multi.mp3");

    expect(axios.post).toHaveBeenCalledWith(
      "https://texttospeech.googleapis.com/v1/text:synthesize",
      expect.objectContaining({
        input: {
          text: "Speaker1: Hi.\nSpeaker2: Hey.",
          prompt: "Speaker1 sounds insightful, dry wit. Speaker2 sounds warm, enthusiastic, curious.",
        },
      }),
      expect.any(Object)
    );
  });

  it("omits input.prompt entirely when no turn has a voiceStyle set", async () => {
    (axios.post as any).mockResolvedValue({ data: { audioContent: Buffer.from("x").toString("base64") } });

    const provider = new GoogleGeminiMultispeakerProvider();
    const turns = [makeTurn("sp1", "Puck", "Hi."), makeTurn("sp2", "Kore", "Hey.")];

    await provider.synthesizeChunk(turns, "chunks/no-style.mp3");

    expect(axios.post).toHaveBeenCalledWith(
      "https://texttospeech.googleapis.com/v1/text:synthesize",
      expect.objectContaining({
        input: { text: "Speaker1: Hi.\nSpeaker2: Hey." },
      }),
      expect.any(Object)
    );
  });

  it("includes LLM-inserted delivery tags in input.text for a single-speaker chunk when tagging succeeds and preserves wording", async () => {
    (axios.post as any).mockResolvedValue({ data: { audioContent: Buffer.from("x").toString("base64") } });
    (AiModelFactory.getModel as any).mockReturnValue({
      invoke: vi.fn().mockResolvedValue({ content: "Solo line, [pause] with a beat." }),
    });

    const provider = new GoogleGeminiMultispeakerProvider();
    const turns = [makeTurn("sp1", "Puck", "Solo line, with a beat.")];

    await provider.synthesizeChunk(turns, "chunks/tagged-solo.mp3");

    expect(axios.post).toHaveBeenCalledWith(
      "https://texttospeech.googleapis.com/v1/text:synthesize",
      expect.objectContaining({
        input: { text: "Solo line, [pause] with a beat." },
      }),
      expect.any(Object)
    );
  });

  it("includes LLM-inserted delivery tags in input.text for each turn of a multi-speaker chunk", async () => {
    (axios.post as any).mockResolvedValue({ data: { audioContent: Buffer.from("x").toString("base64") } });
    (AiModelFactory.getModel as any).mockReturnValue({
      invoke: vi
        .fn()
        .mockResolvedValueOnce({ content: "Hi, [pause] there." })
        .mockResolvedValueOnce({ content: "Hey." }),
    });

    const provider = new GoogleGeminiMultispeakerProvider();
    const turns = [makeTurn("sp1", "Puck", "Hi, there."), makeTurn("sp2", "Kore", "Hey.")];

    await provider.synthesizeChunk(turns, "chunks/tagged-multi.mp3");

    expect(axios.post).toHaveBeenCalledWith(
      "https://texttospeech.googleapis.com/v1/text:synthesize",
      expect.objectContaining({
        input: { text: "Speaker1: Hi, [pause] there.\nSpeaker2: Hey." },
      }),
      expect.any(Object)
    );
  });

  it("falls back to the plain (untagged) text when the LLM changes the wording", async () => {
    (axios.post as any).mockResolvedValue({ data: { audioContent: Buffer.from("x").toString("base64") } });
    (AiModelFactory.getModel as any).mockReturnValue({
      invoke: vi.fn().mockResolvedValue({ content: "Solo lines, [pause] with a beat." }),
    });

    const provider = new GoogleGeminiMultispeakerProvider();
    const turns = [makeTurn("sp1", "Puck", "Solo line, with a beat.")];

    await provider.synthesizeChunk(turns, "chunks/mismatch-solo.mp3");

    expect(axios.post).toHaveBeenCalledWith(
      "https://texttospeech.googleapis.com/v1/text:synthesize",
      expect.objectContaining({ input: { text: "Solo line, with a beat." } }),
      expect.any(Object)
    );
  });

  it("falls back to the plain text when the tagging model throws", async () => {
    (axios.post as any).mockResolvedValue({ data: { audioContent: Buffer.from("x").toString("base64") } });
    (AiModelFactory.getModel as any).mockReturnValue({
      invoke: vi.fn().mockRejectedValue(new Error("model unavailable")),
    });

    const provider = new GoogleGeminiMultispeakerProvider();
    const turns = [makeTurn("sp1", "Puck", "Solo line.")];

    await provider.synthesizeChunk(turns, "chunks/model-error-solo.mp3");

    expect(axios.post).toHaveBeenCalledWith(
      "https://texttospeech.googleapis.com/v1/text:synthesize",
      expect.objectContaining({ input: { text: "Solo line." } }),
      expect.any(Object)
    );
  });

  it("falls back to the plain text when the LLM returns an empty response", async () => {
    (axios.post as any).mockResolvedValue({ data: { audioContent: Buffer.from("x").toString("base64") } });
    (AiModelFactory.getModel as any).mockReturnValue({
      invoke: vi.fn().mockResolvedValue({ content: "" }),
    });

    const provider = new GoogleGeminiMultispeakerProvider();
    const turns = [makeTurn("sp1", "Puck", "Solo line.")];

    await provider.synthesizeChunk(turns, "chunks/empty-response-solo.mp3");

    expect(axios.post).toHaveBeenCalledWith(
      "https://texttospeech.googleapis.com/v1/text:synthesize",
      expect.objectContaining({ input: { text: "Solo line." } }),
      expect.any(Object)
    );
  });

  it("keeps buildStylePrompt's per-line override quoting on the original untagged text even when tagging changes what's spoken", async () => {
    (axios.post as any).mockResolvedValue({ data: { audioContent: Buffer.from("x").toString("base64") } });
    (AiModelFactory.getModel as any).mockReturnValue({
      invoke: vi.fn().mockResolvedValue({ content: "Right, [pause] of course." }),
    });

    const provider = new GoogleGeminiMultispeakerProvider();
    const turns = [
      { ...makeTurn("sp1", "Puck", "First line."), voiceStyle: "insightful, dry wit" },
      { ...makeTurn("sp1", "Puck", "Right, of course."), voiceStyle: "dry, sardonic humor" },
    ];

    await provider.synthesizeChunk(turns, "chunks/override-plus-tags.mp3");

    expect(axios.post).toHaveBeenCalledWith(
      "https://texttospeech.googleapis.com/v1/text:synthesize",
      expect.objectContaining({
        input: {
          text: "First line.\nRight, [pause] of course.",
          prompt:
            'Speak with insightful, dry wit. For the line "Right, of course.", sound dry, sardonic humor instead.',
        },
      }),
      expect.any(Object)
    );
  });

  it("strips markdown emphasis before sending text to the delivery-tagging model", async () => {
    (axios.post as any).mockResolvedValue({ data: { audioContent: Buffer.from("x").toString("base64") } });
    const invokeMock = vi.fn().mockResolvedValue({ content: "" });
    (AiModelFactory.getModel as any).mockReturnValue({ invoke: invokeMock });

    const provider = new GoogleGeminiMultispeakerProvider();
    const turns = [makeTurn("sp1", "Puck", "It's called *Omphalotus nidiformis*.")];

    await provider.synthesizeChunk(turns, "chunks/markdown-before-tagging.mp3");

    const humanMessage = invokeMock.mock.calls[0][0][1];
    expect(humanMessage.content).toBe("It's called Omphalotus nidiformis.");
  });

  it("adds a per-line override in single-voice mode when one turn's voiceStyle differs from the speaker's usual style", async () => {
    (axios.post as any).mockResolvedValue({ data: { audioContent: Buffer.from("x").toString("base64") } });

    const provider = new GoogleGeminiMultispeakerProvider();
    const turns = [
      { ...makeTurn("sp1", "Puck", "First line."), voiceStyle: "insightful, dry wit" },
      { ...makeTurn("sp1", "Puck", "Right, of course."), voiceStyle: "dry, sardonic humor" },
      { ...makeTurn("sp1", "Puck", "Third line."), voiceStyle: "insightful, dry wit" },
    ];

    await provider.synthesizeChunk(turns, "chunks/override-solo.mp3");

    expect(axios.post).toHaveBeenCalledWith(
      "https://texttospeech.googleapis.com/v1/text:synthesize",
      expect.objectContaining({
        input: {
          text: "First line.\nRight, of course.\nThird line.",
          prompt:
            'Speak with insightful, dry wit. For the line "Right, of course.", sound dry, sardonic humor instead.',
        },
      }),
      expect.any(Object)
    );
  });

  it("adds a per-line override in multi-speaker mode when one turn's voiceStyle differs from that speaker's usual style", async () => {
    (axios.post as any).mockResolvedValue({ data: { audioContent: Buffer.from("x").toString("base64") } });

    const provider = new GoogleGeminiMultispeakerProvider();
    const turns = [
      { ...makeTurn("sp1", "Puck", "Hi."), voiceStyle: "insightful, dry wit" },
      { ...makeTurn("sp2", "Kore", "Hey."), voiceStyle: "warm, enthusiastic, curious" },
      { ...makeTurn("sp1", "Puck", "Right, of course."), voiceStyle: "dry, sardonic humor" },
    ];

    await provider.synthesizeChunk(turns, "chunks/override-multi.mp3");

    expect(axios.post).toHaveBeenCalledWith(
      "https://texttospeech.googleapis.com/v1/text:synthesize",
      expect.objectContaining({
        input: {
          text: "Speaker1: Hi.\nSpeaker2: Hey.\nSpeaker1: Right, of course.",
          prompt:
            'Speaker1 sounds insightful, dry wit. For the line "Right, of course.", Speaker1 should sound dry, sardonic humor instead. Speaker2 sounds warm, enthusiastic, curious.',
        },
      }),
      expect.any(Object)
    );
  });

  it("rejects an empty turn list", async () => {
    const provider = new GoogleGeminiMultispeakerProvider();
    await expect(provider.synthesizeChunk([], "chunks/empty.mp3")).rejects.toThrow(
      "synthesizeChunk requires at least one turn"
    );
  });

  it("redacts the Authorization header (config and raw request._header) before logging a failed synthesizeChunk request", async () => {
    const axiosError: any = {
      isAxiosError: true,
      message: "Request failed with status code 403",
      config: { headers: { Authorization: "Bearer test-access-token" } },
      request: { _header: "POST /v1/text:synthesize HTTP/1.1\r\nAuthorization: Bearer test-access-token\r\n\r\n" },
    };
    (axios.post as any).mockRejectedValue(axiosError);
    (axios.isAxiosError as any).mockReturnValue(true);

    const provider = new GoogleGeminiMultispeakerProvider();
    const turns = [makeTurn("sp1", "Puck", "Hello there.")];

    await expect(provider.synthesizeChunk(turns, "chunks/fail.mp3")).rejects.toBe(axiosError);

    expect(axiosError.config.headers.Authorization).toBe("[REDACTED]");
    expect(axiosError.request._header).not.toContain("test-access-token");
    expect(axiosError.request._header).toContain("Authorization: [REDACTED]");
  });

  it("returns the known Gemini TTS voice catalogue tagged with the provider enum", async () => {
    const provider = new GoogleGeminiMultispeakerProvider();
    const voices = await provider.getVoices();

    expect(voices.length).toBeGreaterThan(0);
    expect(voices[0]).toEqual({
      id: "Zephyr",
      name: "Zephyr",
      description: "Google Gemini TTS multispeaker voice: Zephyr",
      provider: VocalProviderName.GoogleGeminiMultispeaker,
      providerId: "Zephyr",
      settings: {},
    });
  });
});
