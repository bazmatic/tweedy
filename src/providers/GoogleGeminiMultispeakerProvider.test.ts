import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";
import * as fs from "fs-extra";
import { GoogleGeminiMultispeakerProvider } from "./GoogleGeminiMultispeakerProvider";
import { VocalProviderName } from "../types";
import type { MultispeakerTurn } from "../types";

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

  it("rejects an empty turn list", async () => {
    const provider = new GoogleGeminiMultispeakerProvider();
    await expect(provider.synthesizeChunk([], "chunks/empty.mp3")).rejects.toThrow(
      "synthesizeChunk requires at least one turn"
    );
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
