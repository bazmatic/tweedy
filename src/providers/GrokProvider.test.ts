import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";
import * as fs from "fs-extra";
import { GrokProvider } from "./GrokProvider";
import { VocalProviderName } from "../types";
import { AiModelFactory } from "../providers/AiModelFactory";

vi.mock("axios");
vi.mock("fs-extra", () => ({
  ensureDir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../providers/AiModelFactory", () => ({
  AiModelFactory: { getModel: vi.fn() },
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

  it("maps the voices endpoint response into the shared Voice shape", async () => {
    (axios.get as any).mockResolvedValue({
      data: [
        { id: "eve", name: "Eve", description: "Warm, natural voice" },
        { id: "rex", name: "Rex" },
      ],
    });

    const provider = new GrokProvider();
    const voices = await provider.getVoices();

    expect(axios.get).toHaveBeenCalledWith("https://api.x.ai/v1/tts/voices", {
      headers: {
        Authorization: "Bearer test-key",
        "Content-Type": "application/json",
      },
    });
    expect(voices).toEqual([
      {
        id: "eve",
        name: "Eve",
        description: "Warm, natural voice",
        provider: VocalProviderName.Grok,
        providerId: "eve",
        settings: {},
      },
      {
        id: "rex",
        name: "Rex",
        description: "Rex",
        provider: VocalProviderName.Grok,
        providerId: "rex",
        settings: {},
      },
    ]);
  });

  it("unwraps a { data: [...] } envelope from the voices endpoint", async () => {
    (axios.get as any).mockResolvedValue({
      data: { data: [{ id: "ara", name: "Ara" }] },
    });

    const provider = new GrokProvider();
    const voices = await provider.getVoices();

    expect(voices).toHaveLength(1);
    expect(voices[0].id).toBe("ara");
  });

  it("sends LLM-tagged text to the TTS endpoint instead of the raw message", async () => {
    const arrayBuffer = new TextEncoder().encode("audio-bytes").buffer;
    (axios.post as any).mockResolvedValue({ data: arrayBuffer });
    (AiModelFactory.getModel as any).mockReturnValue({
      invoke: vi.fn().mockResolvedValue({ content: "Hello [pause] there." }),
    });

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
      message: "Hello there.",
      instructions: "",
      voice,
      voiceStyle: "",
      timestamp: new Date(),
    };

    await provider.tts({
      speech: speech as any,
      voice: voice as any,
      outputFileName: "tagged.mp3",
    });

    expect(axios.post).toHaveBeenCalledWith(
      "https://api.x.ai/v1/tts",
      expect.objectContaining({ text: "Hello [pause] there." }),
      expect.any(Object)
    );
  });

  it("falls back to the original message when tag injection fails", async () => {
    const arrayBuffer = new TextEncoder().encode("audio-bytes").buffer;
    (axios.post as any).mockResolvedValue({ data: arrayBuffer });
    (AiModelFactory.getModel as any).mockReturnValue({
      invoke: vi.fn().mockRejectedValue(new Error("model unavailable")),
    });

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
      message: "Hello there.",
      instructions: "",
      voice,
      voiceStyle: "",
      timestamp: new Date(),
    };

    await provider.tts({
      speech: speech as any,
      voice: voice as any,
      outputFileName: "fallback.mp3",
    });

    expect(axios.post).toHaveBeenCalledWith(
      "https://api.x.ai/v1/tts",
      expect.objectContaining({ text: "Hello there." }),
      expect.any(Object)
    );
  });

  it("falls back to the original message when the LLM emits a malformed or invented tag", async () => {
    const arrayBuffer = new TextEncoder().encode("audio-bytes").buffer;
    (axios.post as any).mockResolvedValue({ data: arrayBuffer });
    (AiModelFactory.getModel as any).mockReturnValue({
      invoke: vi
        .fn()
        .mockResolvedValue({ content: "Hello [emphasis]there[/emphasis]." }),
    });

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
      message: "Hello there.",
      instructions: "",
      voice,
      voiceStyle: "",
      timestamp: new Date(),
    };

    await provider.tts({
      speech: speech as any,
      voice: voice as any,
      outputFileName: "malformed.mp3",
    });

    expect(axios.post).toHaveBeenCalledWith(
      "https://api.x.ai/v1/tts",
      expect.objectContaining({ text: "Hello there." }),
      expect.any(Object)
    );
  });

  it("falls back to the original message when the LLM changes the wording", async () => {
    const arrayBuffer = new TextEncoder().encode("audio-bytes").buffer;
    (axios.post as any).mockResolvedValue({ data: arrayBuffer });
    (AiModelFactory.getModel as any).mockReturnValue({
      invoke: vi.fn().mockResolvedValue({ content: "Hi [pause] there." }),
    });

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
      message: "Hello there.",
      instructions: "",
      voice,
      voiceStyle: "",
      timestamp: new Date(),
    };

    await provider.tts({
      speech: speech as any,
      voice: voice as any,
      outputFileName: "reworded.mp3",
    });

    expect(axios.post).toHaveBeenCalledWith(
      "https://api.x.ai/v1/tts",
      expect.objectContaining({ text: "Hello there." }),
      expect.any(Object)
    );
  });

  it("falls back to the original message when a tag is inserted mid-word", async () => {
    const arrayBuffer = new TextEncoder().encode("audio-bytes").buffer;
    (axios.post as any).mockResolvedValue({ data: arrayBuffer });
    (AiModelFactory.getModel as any).mockReturnValue({
      invoke: vi
        .fn()
        .mockResolvedValue({
          content: "There's your book deal, Archi[laugh]e.",
        }),
    });

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
      message: "There's your book deal, Archie.",
      instructions: "",
      voice,
      voiceStyle: "",
      timestamp: new Date(),
    };

    await provider.tts({
      speech: speech as any,
      voice: voice as any,
      outputFileName: "midword.mp3",
    });

    expect(axios.post).toHaveBeenCalledWith(
      "https://api.x.ai/v1/tts",
      expect.objectContaining({ text: "There's your book deal, Archie." }),
      expect.any(Object)
    );
  });
});
