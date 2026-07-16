import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";
import * as fs from "fs-extra";
import { GoogleChirpProvider } from "./GoogleChirpProvider";
import { VocalProviderName } from "../types";

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

describe("GoogleChirpProvider", () => {
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
    expect(() => new GoogleChirpProvider()).toThrow(
      "GOOGLE_APPLICATION_CREDENTIALS environment variable is required"
    );
  });

  it("posts the expected body with a Bearer token and writes the decoded audio to disk", async () => {
    const audioB64 = Buffer.from("audio-bytes").toString("base64");
    (axios.post as any).mockResolvedValue({ data: { audioContent: audioB64 } });

    const provider = new GoogleChirpProvider();
    const voice = {
      id: "v1",
      name: "Achernar",
      description: "Achernar",
      provider: VocalProviderName.GoogleChirp,
      providerId: "en-US-Chirp3-HD-Achernar",
      settings: { providerOptions: { languageCode: "en-US", speakingRate: 1.1 } },
    };
    const speech = {
      id: "s1",
      speaker: {} as any,
      message: "Hello there.",
      instructions: "",
      voice,
      voiceStyle: "",
      timestamp: new Date(),
    };

    const result = await provider.tts({
      speech: speech as any,
      voice: voice as any,
      outputFileName: "out.mp3",
    });

    expect(axios.post).toHaveBeenCalledWith(
      "https://texttospeech.googleapis.com/v1/text:synthesize",
      {
        input: { text: "Hello there." },
        voice: { languageCode: "en-US", name: "en-US-Chirp3-HD-Achernar" },
        audioConfig: { audioEncoding: "MP3", speakingRate: 1.1 },
      },
      { headers: { Authorization: "Bearer test-access-token", "Content-Type": "application/json" } }
    );
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("out.mp3"),
      Buffer.from(audioB64, "base64")
    );
    expect(result.outputPath).toContain("out.mp3");
    expect(result.wordTimestamps).toBeUndefined();
  });

  it("defaults languageCode to en-US and omits speakingRate when providerOptions has neither", async () => {
    (axios.post as any).mockResolvedValue({
      data: { audioContent: Buffer.from("audio-bytes").toString("base64") },
    });

    const provider = new GoogleChirpProvider();
    const voice = {
      id: "v1",
      name: "Achernar",
      description: "Achernar",
      provider: VocalProviderName.GoogleChirp,
      providerId: "en-US-Chirp3-HD-Achernar",
      settings: {},
    };
    const speech = {
      id: "s1",
      speaker: {} as any,
      message: "Hi.",
      instructions: "",
      voice,
      voiceStyle: "",
      timestamp: new Date(),
    };

    await provider.tts({
      speech: speech as any,
      voice: voice as any,
      outputFileName: "out2.mp3",
    });

    expect(axios.post).toHaveBeenCalledWith(
      "https://texttospeech.googleapis.com/v1/text:synthesize",
      {
        input: { text: "Hi." },
        voice: { languageCode: "en-US", name: "en-US-Chirp3-HD-Achernar" },
        audioConfig: { audioEncoding: "MP3" },
      },
      expect.any(Object)
    );
  });

  it("fetches voices and filters to Chirp3-HD names only", async () => {
    (axios.get as any).mockResolvedValue({
      data: {
        voices: [
          {
            name: "en-US-Chirp3-HD-Achernar",
            languageCodes: ["en-US"],
            ssmlGender: "FEMALE",
          },
          {
            name: "en-US-Standard-A",
            languageCodes: ["en-US"],
            ssmlGender: "FEMALE",
          },
          {
            name: "en-US-Chirp3-HD-Puck",
            languageCodes: ["en-US"],
            ssmlGender: "MALE",
          },
        ],
      },
    });

    const provider = new GoogleChirpProvider();
    const voices = await provider.getVoices();

    expect(axios.get).toHaveBeenCalledWith(
      "https://texttospeech.googleapis.com/v1/voices",
      { headers: { Authorization: "Bearer test-access-token" } }
    );
    expect(voices).toEqual([
      {
        id: "en-US-Chirp3-HD-Achernar",
        name: "Achernar (en-US)",
        description: "Google Chirp3-HD voice, en-US, FEMALE",
        provider: VocalProviderName.GoogleChirp,
        providerId: "en-US-Chirp3-HD-Achernar",
        settings: { providerOptions: { languageCode: "en-US" } },
      },
      {
        id: "en-US-Chirp3-HD-Puck",
        name: "Puck (en-US)",
        description: "Google Chirp3-HD voice, en-US, MALE",
        provider: VocalProviderName.GoogleChirp,
        providerId: "en-US-Chirp3-HD-Puck",
        settings: { providerOptions: { languageCode: "en-US" } },
      },
    ]);
  });
});
