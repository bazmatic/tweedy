import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { ffmpegState, commandMock, ffmpegFn } = vi.hoisted(() => {
  const ffmpegState = {
    handlers: {} as Record<string, (...args: any[]) => void>,
    stderrLines: [] as string[],
  };

  const commandMock: any = {
    audioFilters: vi.fn().mockReturnThis(),
    format: vi.fn().mockReturnThis(),
    output: vi.fn().mockReturnThis(),
    on: vi.fn().mockImplementation(function (this: any, event: string, cb: (...args: any[]) => void) {
      ffmpegState.handlers[event] = cb;
      return this;
    }),
    run: vi.fn().mockImplementation(() => {
      for (const line of ffmpegState.stderrLines) {
        ffmpegState.handlers["stderr"]?.(line);
      }
      ffmpegState.handlers["end"]?.();
    }),
  };

  const ffmpegFn: any = vi.fn(() => commandMock);
  ffmpegFn.ffprobe = vi.fn((_path: string, cb: (err: unknown, data: any) => void) => {
    cb(null, { format: { duration: 9 } });
  });

  return { ffmpegState, commandMock, ffmpegFn };
});

vi.mock("fluent-ffmpeg", () => ({ default: ffmpegFn }));

import { splitChunkIntoTurns } from "./silence-turn-splitter";

describe("splitChunkIntoTurns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ffmpegState.handlers = {};
    ffmpegState.stderrLines = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the whole clip as one boundary when turnCount is 1", async () => {
    const boundaries = await splitChunkIntoTurns("chunk.mp3", 1);
    expect(boundaries).toEqual([{ startSeconds: 0, endSeconds: 9 }]);
  });

  it("splits on detected silence gaps when the gap count matches turnCount - 1", async () => {
    ffmpegState.stderrLines = [
      "silence_start: 3.000",
      "silence_end: 3.200",
      "silence_start: 6.000",
      "silence_end: 6.150",
    ];

    const boundaries = await splitChunkIntoTurns("chunk.mp3", 3);

    expect(boundaries).toEqual([
      { startSeconds: 0, endSeconds: 3 },
      { startSeconds: 3, endSeconds: 6 },
      { startSeconds: 6, endSeconds: 9 },
    ]);
  });

  it("falls back to evenly dividing the clip when the detected gap count doesn't match", async () => {
    ffmpegState.stderrLines = ["silence_start: 3.000", "silence_end: 3.200"];

    const boundaries = await splitChunkIntoTurns("chunk.mp3", 3);

    expect(boundaries).toEqual([
      { startSeconds: 0, endSeconds: 3 },
      { startSeconds: 3, endSeconds: 6 },
      { startSeconds: 6, endSeconds: 9 },
    ]);
  });
});
