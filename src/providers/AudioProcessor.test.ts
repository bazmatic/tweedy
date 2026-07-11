import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("fluent-ffmpeg");
vi.mock("fs-extra");

import ffmpeg from "fluent-ffmpeg";
import * as fs from "fs-extra";
import { AudioProcessor } from "./AudioProcessor";

const ffmpegState = {
  handlers: {} as Record<string, (...args: any[]) => void>,
};

const commandMock: any = {
  input: vi.fn().mockReturnThis(),
  complexFilter: vi.fn().mockReturnThis(),
  output: vi.fn().mockReturnThis(),
  audioFilters: vi.fn().mockReturnThis(),
  format: vi.fn().mockReturnThis(),
  outputOptions: vi.fn().mockReturnThis(),
  on: vi.fn().mockImplementation(function (this: any, event: string, cb: (...args: any[]) => void) {
    ffmpegState.handlers[event] = cb;
    return this;
  }),
  run: vi.fn().mockImplementation(() => {
    // Simulate ffmpeg completing successfully.
    ffmpegState.handlers["end"]?.();
  }),
};

const ffmpegMock = vi.fn(() => commandMock);
(ffmpegMock as any).ffprobe = vi.fn((_path: string, cb: (err: unknown, data: any) => void) => {
  cb(null, { format: { duration: 5 } });
});

vi.mocked(ffmpeg).mockImplementation(ffmpegMock as any);
vi.mocked(ffmpeg).ffprobe = (ffmpegMock as any).ffprobe;

vi.mocked(fs).ensureDir = vi.fn().mockResolvedValue(undefined);

describe("AudioProcessor.concatenateAudio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ffmpegState.handlers = {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves with per-clip offsets and speech-end timings instead of void", async () => {
    vi.spyOn(AudioProcessor, "getSpeechEndSeconds")
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);

    const timing = await AudioProcessor.concatenateAudio(
      ["clip1.mp3", "clip2.mp3"],
      "out.mp3",
      [false, false]
    );

    expect(timing).toEqual({
      offsetsSeconds: [0, 2.3],
      speechEndSeconds: [2, 3],
    });
  });

  it("reflects an interjection's offset (relative to the previous clip's speech end) in the returned timing", async () => {
    vi.spyOn(AudioProcessor, "getSpeechEndSeconds")
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(1);

    const timing = await AudioProcessor.concatenateAudio(
      ["clip1.mp3", "clip2.mp3"],
      "out.mp3",
      [false, true]
    );

    expect(timing.offsetsSeconds).toEqual([0, 4]);
  });
});
