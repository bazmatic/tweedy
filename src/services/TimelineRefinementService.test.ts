import { describe, expect, it, vi, beforeEach } from "vitest";

// vi.mock(...) calls are hoisted above all imports and top-level consts, so
// anything a factory closes over must itself be created via vi.hoisted.
const { mockExtractAudioChunk, mockGetProvider, mockRemove, mockEnsureDir } = vi.hoisted(() => ({
  mockExtractAudioChunk: vi.fn().mockResolvedValue(undefined),
  mockGetProvider: vi.fn(),
  mockRemove: vi.fn().mockResolvedValue(undefined),
  mockEnsureDir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../providers/AudioProcessor", () => ({
  AudioProcessor: { extractAudioChunk: mockExtractAudioChunk },
}));

vi.mock("../providers/TranscriptionProviderFactory", () => ({
  TranscriptionProviderFactory: { getProvider: mockGetProvider },
}));

vi.mock("fs-extra", () => ({
  ensureDir: mockEnsureDir,
  remove: mockRemove,
}));

import { TimelineRefinementService } from "./TimelineRefinementService";
import type { Timeline } from "./AudioService";

function timeline(): Timeline {
  return {
    audioFile: "/audio/podcast-1.mp3",
    entries: [
      {
        speechId: "s1",
        speakerId: "sp1",
        speakerName: "Alex",
        message: "hello there",
        tool: undefined,
        isInterjection: false,
        startSeconds: 0,
        endSeconds: 1,
      },
      {
        speechId: "s2",
        speakerId: "sp2",
        speakerName: "Sam",
        message: "good to see you",
        tool: undefined,
        isInterjection: false,
        startSeconds: 1.3,
        endSeconds: 2.5,
      },
    ],
  };
}

describe("TimelineRefinementService.refineTimeline", () => {
  const transcribeMock = vi.fn();

  beforeEach(() => {
    mockExtractAudioChunk.mockClear();
    mockGetProvider.mockReturnValue({ transcribe: transcribeMock });
    transcribeMock.mockReset();
  });

  it("extracts one chunk covering all entries when under the duration cap, transcribes it, and aligns words", async () => {
    transcribeMock.mockResolvedValue({
      words: [
        { word: "hello", startSeconds: 0.1, endSeconds: 0.4 },
        { word: "there", startSeconds: 0.4, endSeconds: 0.9 },
        { word: "good", startSeconds: 1.4, endSeconds: 1.6 },
        { word: "to", startSeconds: 1.6, endSeconds: 1.7 },
        { word: "see", startSeconds: 1.7, endSeconds: 1.9 },
        { word: "you", startSeconds: 1.9, endSeconds: 2.4 },
      ],
    });

    const result = await TimelineRefinementService.refineTimeline(
      "/audio/podcast-1.mp3",
      timeline()
    );

    expect(mockExtractAudioChunk).toHaveBeenCalledTimes(1);
    expect(result.entries[0].wordTimestamps?.map((w) => w.word)).toEqual(["hello", "there"]);
    expect(result.entries[1].wordTimestamps?.map((w) => w.word)).toEqual([
      "good",
      "to",
      "see",
      "you",
    ]);
    expect(result.audioFile).toBe("/audio/podcast-1.mp3");
  });

  it("offsets a second chunk's word timestamps by that chunk's start time before aligning", async () => {
    transcribeMock
      .mockResolvedValueOnce({
        words: [
          { word: "hello", startSeconds: 0.1, endSeconds: 0.4 },
          { word: "there", startSeconds: 0.4, endSeconds: 0.9 },
        ],
      })
      .mockResolvedValueOnce({
        // Chunk-relative timestamps: this chunk starts at track time 1.3s,
        // so word timestamps here are relative to that chunk's own start.
        words: [
          { word: "good", startSeconds: 0.1, endSeconds: 0.3 },
          { word: "to", startSeconds: 0.3, endSeconds: 0.4 },
          { word: "see", startSeconds: 0.4, endSeconds: 0.6 },
          { word: "you", startSeconds: 0.6, endSeconds: 1.1 },
        ],
      });

    const result = await TimelineRefinementService.refineTimeline(
      "/audio/podcast-1.mp3",
      timeline(),
      1 // maxChunkSeconds forces a chunk split between the two entries
    );

    expect(mockExtractAudioChunk).toHaveBeenCalledTimes(2);
    // Second chunk started at 1.3s track time, so "good" at chunk-relative
    // 0.1s should be offset to track-absolute 1.4s.
    expect(result.entries[1].startSeconds).toBeCloseTo(1.4);
    expect(result.entries[1].endSeconds).toBeCloseTo(2.4);
  });

  it("falls back to the original timeline unchanged if a transcription call throws", async () => {
    transcribeMock.mockRejectedValue(new Error("rate limited"));

    const original = timeline();
    const result = await TimelineRefinementService.refineTimeline(
      "/audio/podcast-1.mp3",
      original
    );

    expect(result).toEqual(original);
  });
});
