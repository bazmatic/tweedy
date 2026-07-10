import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";
import * as fs from "fs-extra";
import { GrokProvider } from "./GrokProvider";
import { VocalProviderName } from "../types";

vi.mock("axios");
vi.mock("fs-extra", () => ({
  ensureDir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

describe("GrokProvider", () => {
  const originalKey = process.env.XAI_API_KEY;

  beforeEach(() => {
    process.env.XAI_API_KEY = "test-key";
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.XAI_API_KEY = originalKey;
  });

  it("throws if XAI_API_KEY is missing", () => {
    delete process.env.XAI_API_KEY;
    expect(() => new GrokProvider()).toThrow(
      "XAI_API_KEY environment variable is required"
    );
  });

  it("posts the expected body and writes the returned audio to disk", async () => {
    const arrayBuffer = new TextEncoder().encode("audio-bytes").buffer;
    (axios.post as any).mockResolvedValue({ data: arrayBuffer });

    const provider = new GrokProvider();
    const voice = {
      id: "v1",
      name: "Eve",
      description: "Eve",
      provider: VocalProviderName.Grok,
      providerId: "eve",
      settings: { providerOptions: { speed: 1.2, language: "en" } },
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

    const outputPath = await provider.tts({
      speech: speech as any,
      voice: voice as any,
      outputFileName: "out.mp3",
    });

    expect(axios.post).toHaveBeenCalledWith(
      "https://api.x.ai/v1/tts",
      {
        text: "Hello there.",
        voice_id: "eve",
        language: "en",
        output_format: { container: "mp3", sample_rate: 24000 },
        speed: 1.2,
      },
      {
        headers: {
          Authorization: "Bearer test-key",
          "Content-Type": "application/json",
        },
        responseType: "arraybuffer",
      }
    );
    expect(fs.writeFile).toHaveBeenCalled();
    expect(outputPath).toContain("out.mp3");
  });

  it("defaults language to 'auto' and omits speed when providerOptions has neither", async () => {
    const arrayBuffer = new TextEncoder().encode("audio-bytes").buffer;
    (axios.post as any).mockResolvedValue({ data: arrayBuffer });

    const provider = new GrokProvider();
    const voice = {
      id: "v1",
      name: "Eve",
      description: "Eve",
      provider: VocalProviderName.Grok,
      providerId: "eve",
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
      "https://api.x.ai/v1/tts",
      {
        text: "Hi.",
        voice_id: "eve",
        language: "auto",
        output_format: { container: "mp3", sample_rate: 24000 },
      },
      expect.any(Object)
    );
  });
});
