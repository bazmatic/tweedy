import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";
import * as fs from "fs-extra";
import { HumeProvider } from "./HumeProvider";
import { VocalProviderName } from "../types";

vi.mock("axios");
vi.mock("fs-extra", () => ({
  ensureDir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

function makeVoice(overrides: any = {}) {
  return {
    id: "v1",
    name: "Rex",
    description: "Rex",
    provider: VocalProviderName.Hume,
    providerId: "hume-voice-id",
    settings: {},
    ...overrides,
  };
}

function makeSpeech(message: string, voice: any, overrides: any = {}) {
  return {
    id: "s1",
    speaker: { id: "speaker-1" },
    message,
    instructions: "",
    voice,
    voiceStyle: "",
    timestamp: new Date(),
    ...overrides,
  };
}

function mockAudioResponse(generationId: string) {
  return {
    data: {
      generations: [
        { generation_id: generationId, audio: Buffer.from("audio").toString("base64") },
      ],
    },
  };
}

describe("HumeProvider", () => {
  const originalKey = process.env.HUME_API_KEY;

  beforeEach(() => {
    process.env.HUME_API_KEY = "test-key";
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.HUME_API_KEY = originalKey;
  });

  it("throws if HUME_API_KEY is missing", () => {
    delete process.env.HUME_API_KEY;
    expect(() => new HumeProvider()).toThrow(
      "HUME_API_KEY environment variable is required"
    );
  });

  describe("description weighting", () => {
    it("uses only the voice's baseline instructions when there is no per-turn style", async () => {
      (axios.post as any).mockResolvedValue(mockAudioResponse("gen-1"));
      const provider = new HumeProvider();
      const voice = makeVoice({ settings: { instructions: "a gravelly, world-weary DJ" } });

      await provider.tts({
        speech: makeSpeech("Hello.", voice, { instructions: "" }),
        voice,
        outputFileName: "out.mp3",
      } as any);

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          utterances: [
            expect.objectContaining({
              description: "a gravelly, world-weary DJ",
            }),
          ],
        }),
        expect.any(Object)
      );
    });

    it("uses only the per-turn style when the voice has no baseline instructions", async () => {
      (axios.post as any).mockResolvedValue(mockAudioResponse("gen-1"));
      const provider = new HumeProvider();
      const voice = makeVoice({ settings: {} });

      await provider.tts({
        speech: makeSpeech("Hello.", voice, { instructions: "sounding excited" }),
        voice,
        outputFileName: "out.mp3",
      } as any);

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          utterances: [expect.objectContaining({ description: "sounding excited" })],
        }),
        expect.any(Object)
      );
    });

    it("subordinates the per-turn style to the voice's dominant baseline instructions", async () => {
      (axios.post as any).mockResolvedValue(mockAudioResponse("gen-1"));
      const provider = new HumeProvider();
      const voice = makeVoice({ settings: { instructions: "a gravelly, world-weary DJ" } });

      await provider.tts({
        speech: makeSpeech("Hello.", voice, { instructions: "sounding excited" }),
        voice,
        outputFileName: "out.mp3",
      } as any);

      const [, body] = (axios.post as any).mock.calls[0];
      const description: string = body.utterances[0].description;

      expect(description.startsWith("a gravelly, world-weary DJ")).toBe(true);
      expect(description).toContain("sounding excited");
      expect(description).not.toBe(
        "a gravelly, world-weary DJ. sounding excited"
      );
    });
  });

  describe("per-speaker context continuity", () => {
    it("sends no context on a speaker's first line", async () => {
      (axios.post as any).mockResolvedValue(mockAudioResponse("gen-1"));
      const provider = new HumeProvider();
      const voice = makeVoice();

      await provider.tts({
        speech: makeSpeech("First line.", voice, { speaker: { id: "speaker-1" } }),
        voice,
        outputFileName: "out.mp3",
      } as any);

      const [, body] = (axios.post as any).mock.calls[0];
      expect(body.context).toBeUndefined();
    });

    it("sends the previous generation_id as context on the same speaker's next line", async () => {
      (axios.post as any)
        .mockResolvedValueOnce(mockAudioResponse("gen-1"))
        .mockResolvedValueOnce(mockAudioResponse("gen-2"));
      const provider = new HumeProvider();
      const voice = makeVoice();

      await provider.tts({
        speech: makeSpeech("First line.", voice, { speaker: { id: "speaker-1" } }),
        voice,
        outputFileName: "out1.mp3",
      } as any);

      await provider.tts({
        speech: makeSpeech("Second line.", voice, { speaker: { id: "speaker-1" } }),
        voice,
        outputFileName: "out2.mp3",
      } as any);

      const [, secondBody] = (axios.post as any).mock.calls[1];
      expect(secondBody.context).toEqual({ generation_id: "gen-1" });
    });

    it("does not carry one speaker's context over to a different speaker", async () => {
      (axios.post as any)
        .mockResolvedValueOnce(mockAudioResponse("gen-1"))
        .mockResolvedValueOnce(mockAudioResponse("gen-2"));
      const provider = new HumeProvider();
      const voice = makeVoice();

      await provider.tts({
        speech: makeSpeech("Speaker A line.", voice, { speaker: { id: "speaker-a" } }),
        voice,
        outputFileName: "out1.mp3",
      } as any);

      await provider.tts({
        speech: makeSpeech("Speaker B line.", voice, { speaker: { id: "speaker-b" } }),
        voice,
        outputFileName: "out2.mp3",
      } as any);

      const [, secondBody] = (axios.post as any).mock.calls[1];
      expect(secondBody.context).toBeUndefined();
    });
  });
});
