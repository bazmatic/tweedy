import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";
import * as fs from "fs-extra";
import { ElevenLabsV3Provider } from "./ElevenLabsV3Provider";
import { VocalProviderName } from "../types";

vi.mock("axios");
vi.mock("fs-extra", () => ({
  ensureDir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

function makeSpeech(message: string, voice: any) {
  return {
    id: "s1",
    speaker: {} as any,
    message,
    instructions: "",
    voice,
    voiceStyle: "",
    timestamp: new Date(),
  };
}

describe("ElevenLabsV3Provider", () => {
  const originalKey = process.env.ELEVENLABS_API_KEY;

  beforeEach(() => {
    process.env.ELEVENLABS_API_KEY = "test-key";
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.ELEVENLABS_API_KEY = originalKey;
  });

  it("throws if ELEVENLABS_API_KEY is missing", () => {
    delete process.env.ELEVENLABS_API_KEY;
    expect(() => new ElevenLabsV3Provider()).toThrow(
      "ELEVENLABS_API_KEY environment variable is required"
    );
  });

  it("defaults to the 'creative' stability preset (0.0) when unset", async () => {
    (axios.post as any).mockResolvedValue({ data: Buffer.from("audio") });

    const provider = new ElevenLabsV3Provider();
    const voice = {
      id: "v1",
      name: "Eve",
      description: "Eve",
      provider: VocalProviderName.ElevenLabsV3,
      providerId: "eve-id",
      settings: {},
    };

    await provider.tts({
      speech: makeSpeech("Hello there.", voice) as any,
      voice: voice as any,
      outputFileName: "out.mp3",
    });

    expect(axios.post).toHaveBeenCalledWith(
      "https://api.elevenlabs.io/v1/text-to-speech/eve-id",
      {
        text: "Hello there.",
        model_id: "eleven_v3",
        voice_settings: {
          stability: 0.0,
          use_speaker_boost: true,
        },
      },
      {
        headers: {
          Accept: "audio/mpeg",
          "Content-Type": "application/json",
          "xi-api-key": "test-key",
        },
        responseType: "arraybuffer",
      }
    );
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("out.mp3"),
      Buffer.from("audio")
    );
  });

  it.each([
    ["creative", 0.0],
    ["natural", 0.5],
    ["robust", 1.0],
  ])("maps stabilityPreset '%s' to %f", async (preset, expected) => {
    (axios.post as any).mockResolvedValue({ data: Buffer.from("audio") });

    const provider = new ElevenLabsV3Provider();
    const voice = {
      id: "v1",
      name: "Eve",
      description: "Eve",
      provider: VocalProviderName.ElevenLabsV3,
      providerId: "eve-id",
      settings: { providerOptions: { stabilityPreset: preset } },
    };

    await provider.tts({
      speech: makeSpeech("Hi.", voice) as any,
      voice: voice as any,
      outputFileName: "out.mp3",
    });

    expect(axios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        voice_settings: { stability: expected, use_speaker_boost: true },
      }),
      expect.any(Object)
    );
  });

  it("getVoices() delegates to the parent ElevenLabsProvider implementation", async () => {
    (axios.get as any).mockResolvedValue({
      data: {
        voices: [
          { voice_id: "eve-id", name: "Eve", description: "Warm voice" },
        ],
      },
    });

    const provider = new ElevenLabsV3Provider();
    const voices = await provider.getVoices();

    expect(axios.get).toHaveBeenCalledWith(
      "https://api.elevenlabs.io/v1/voices",
      { headers: { "xi-api-key": "test-key" } }
    );
    expect(voices).toEqual([
      {
        id: "eve-id",
        name: "Eve",
        description: "Warm voice",
        provider: VocalProviderName.ElevenLabs,
        providerId: "eve-id",
        settings: {
          stability: 0.3,
          similarityBoost: 0.75,
          style: 0.66,
        },
      },
    ]);
  });
});
