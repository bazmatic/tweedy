import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock(...) calls are hoisted above all imports and top-level consts, so
// anything a factory closes over must itself be created via vi.hoisted.
const { ffmpegState, commandMock, ffmpegFn } = vi.hoisted(() => {
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

  const ffmpegFn: any = vi.fn(() => commandMock);
  ffmpegFn.ffprobe = vi.fn((_path: string, cb: (err: unknown, data: any) => void) => {
    cb(null, { format: { duration: 5 } });
  });

  return { ffmpegState, commandMock, ffmpegFn };
});

// Explicit factories only — never let vi.mock("fluent-ffmpeg")/("fs-extra")
// fall back to automocking, which requires loading the real modules (and,
// for fluent-ffmpeg, can trigger real binary-detection/child-process
// behavior at import time instead of a fast, hermetic unit test).
vi.mock("fluent-ffmpeg", () => ({ default: ffmpegFn }));
vi.mock("fs-extra", () => ({ ensureDir: vi.fn().mockResolvedValue(undefined) }));

import { AudioProcessor } from "./AudioProcessor";

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

  it("normalizes each clip's loudness before delaying/mixing, and still loudnorms the final mix", async () => {
    vi.spyOn(AudioProcessor, "getSpeechEndSeconds")
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);

    await AudioProcessor.concatenateAudio(["clip1.mp3", "clip2.mp3"], "out.mp3", [false, false]);

    const filterGraph = commandMock.complexFilter.mock.calls[0][0] as string;

    expect(filterGraph).toContain("[0:a]loudnorm=I=-16:LRA=11:TP=-1.5[n0]");
    expect(filterGraph).toContain("[1:a]loudnorm=I=-16:LRA=11:TP=-1.5[n1]");
    expect(filterGraph).toContain("[n0]adelay=");
    expect(filterGraph).toContain("[n1]adelay=");
    expect(filterGraph.indexOf("[n0]adelay=")).toBeGreaterThan(
      filterGraph.indexOf("[0:a]loudnorm=")
    );
    expect(filterGraph).toContain("amix=inputs=2:dropout_transition=0:normalize=0[mixed]");
    expect(filterGraph).toContain("[mixed]loudnorm=I=-16:LRA=11:TP=-1.5,silenceremove=1:0:-50dB:1:0:-50dB[out]");
  });
});
