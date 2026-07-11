import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockConcatenateAudio, mockWriteJson } = vi.hoisted(() => {
  return {
    mockConcatenateAudio: vi.fn(),
    mockWriteJson: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../providers", () => ({
  VocalProviderFactory: { getProvider: vi.fn() },
  AudioProcessor: {
    concatenateAudio: mockConcatenateAudio,
    processAudio: vi.fn(),
  },
}));

vi.mock("fs-extra", () => ({
  writeJson: mockWriteJson,
}));

import { AudioService } from "./AudioService";
import { SpeakerAgentToolName } from "../agents/speaker-tools";
import { VocalProviderName } from "../types";
import type { Speech, Speaker, Voice } from "../types";

function makeVoice(): Voice {
  return {
    id: "voice-1",
    name: "Voice",
    description: "",
    provider: VocalProviderName.ElevenLabs,
    providerId: "provider-id",
    settings: {},
  };
}

function makeSpeaker(id: string, name: string): Speaker {
  return {
    id,
    slug: id,
    name,
    personality: "curious",
    voice: makeVoice(),
    voiceStyle: "neutral",
    isExpert: false,
  };
}

function makeSpeech(overrides: Partial<Speech> = {}): Speech {
  const speaker = makeSpeaker("sp1", "Ada");
  return {
    id: "s1",
    speaker,
    message: "Hello there",
    instructions: "",
    voice: speaker.voice,
    voiceStyle: "neutral",
    timestamp: new Date(),
    tool: SpeakerAgentToolName.SPEAK,
    ...overrides,
  };
}

describe("AudioService.generateAudio timeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes a sibling timeline JSON built from the speeches and concatenation timing", async () => {
    mockConcatenateAudio.mockResolvedValue({
      offsetsSeconds: [0, 2.3],
      speechEndSeconds: [2, 1.5],
    });

    const service = new AudioService();
    vi.spyOn(service as any, "generateSpeechAudio").mockImplementation(
      async (speech: any) => `/audio/speeches/${speech.id}.mp3`
    );

    const speeches = [
      makeSpeech({ id: "s1" }),
      makeSpeech({
        id: "s2",
        tool: SpeakerAgentToolName.INTERJECT,
        speaker: makeSpeaker("sp2", "Bo"),
        message: "Wait, really?",
      }),
    ];

    await service.generateAudio(speeches, "/audio/podcast-abc123.mp3", "abc123");

    expect(mockWriteJson).toHaveBeenCalledWith(
      "/audio/podcast-abc123.timeline.json",
      {
        scriptId: "abc123",
        audioFile: "/audio/podcast-abc123.mp3",
        entries: [
          {
            speechId: "s1",
            speakerId: "sp1",
            speakerName: "Ada",
            message: "Hello there",
            tool: SpeakerAgentToolName.SPEAK,
            isInterjection: false,
            startSeconds: 0,
            endSeconds: 2,
          },
          {
            speechId: "s2",
            speakerId: "sp2",
            speakerName: "Bo",
            message: "Wait, really?",
            tool: SpeakerAgentToolName.INTERJECT,
            isInterjection: true,
            startSeconds: 2.3,
            endSeconds: 3.8,
          },
        ],
      },
      { spaces: 2 }
    );
  });

  it("omits scriptId from the timeline when none is provided", async () => {
    mockConcatenateAudio.mockResolvedValue({
      offsetsSeconds: [0],
      speechEndSeconds: [2],
    });

    const service = new AudioService();
    vi.spyOn(service as any, "generateSpeechAudio").mockResolvedValue(
      "/audio/speeches/s1.mp3"
    );

    await service.generateAudio([makeSpeech({ id: "s1" })], "/audio/podcast.mp3");

    const [, payload] = mockWriteJson.mock.calls[0];
    expect(payload.scriptId).toBeUndefined();
  });
});
