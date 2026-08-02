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
    setStartTime: vi.fn().mockReturnThis(),
    setDuration: vi.fn().mockReturnThis(),
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

const stubLoudnormStats = {
  input_i: "-20.0",
  input_tp: "-3.0",
  input_lra: "5.0",
  input_thresh: "-30.0",
  target_offset: "1.0",
};

describe("AudioProcessor.concatenateAudio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ffmpegState.handlers = {};
    vi.spyOn(AudioProcessor, "measureLoudness").mockResolvedValue(stubLoudnormStats);
    vi.spyOn(AudioProcessor, "getSpeechStartSeconds").mockResolvedValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves with per-clip offsets, speech-end timings, and lead-trim timings instead of void", async () => {
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
      leadTrimSeconds: [0, 0],
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

  it("gives the clip after a cold open a longer gap than the standard inter-clip gap", async () => {
    vi.spyOn(AudioProcessor, "getSpeechEndSeconds")
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(3);

    const timing = await AudioProcessor.concatenateAudio(
      ["clip1.mp3", "clip2.mp3"],
      "out.mp3",
      [false, false],
      [true, false]
    );

    expect(timing.offsetsSeconds).toEqual([0, 6.2]);
  });

  it("shrinks a clip's leading silence out of the next clip's offset", async () => {
    vi.spyOn(AudioProcessor, "getSpeechEndSeconds")
      .mockResolvedValueOnce(5) // includes 1.2s of leading silence before speech starts
      .mockResolvedValueOnce(3);
    vi.spyOn(AudioProcessor, "getSpeechStartSeconds")
      .mockResolvedValueOnce(1.2)
      .mockResolvedValueOnce(0);

    const timing = await AudioProcessor.concatenateAudio(
      ["clip1.mp3", "clip2.mp3"],
      "out.mp3",
      [false, false]
    );

    // Without the fix this would be 5 + GAP_SECONDS (5.3); the 1.2s of dead
    // air at the start of clip1 should be trimmed out of the gap instead.
    expect(timing.offsetsSeconds).toEqual([0, 5 - 1.2 + 0.3]);
    expect(timing.leadTrimSeconds).toEqual([1.2, 0]);
  });

  it("normalizes each clip's loudness (after trimming leading silence) before delaying/mixing, and still loudnorms the final mix", async () => {
    vi.spyOn(AudioProcessor, "getSpeechEndSeconds")
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);

    await AudioProcessor.concatenateAudio(["clip1.mp3", "clip2.mp3"], "out.mp3", [false, false]);

    const filterGraph = commandMock.complexFilter.mock.calls[0][0] as string;

    expect(filterGraph).toContain("[0:a]atrim=start=0,asetpts=PTS-STARTPTS[t0]");
    expect(filterGraph).toContain("[1:a]atrim=start=0,asetpts=PTS-STARTPTS[t1]");
    expect(filterGraph).toContain("[t0]loudnorm=I=-16:LRA=11:TP=-1.5:measured_I=-20.0");
    expect(filterGraph).toContain("[t1]loudnorm=I=-16:LRA=11:TP=-1.5:measured_I=-20.0");
    expect(filterGraph).toContain("[n0]adelay=");
    expect(filterGraph).toContain("[n1]adelay=");
    expect(filterGraph.indexOf("[n0]adelay=")).toBeGreaterThan(
      filterGraph.indexOf("[t0]loudnorm=")
    );
    expect(filterGraph).toContain("amix=inputs=2:dropout_transition=0:normalize=0[mixed]");
    expect(filterGraph).toContain("[mixed]loudnorm=I=-16:LRA=11:TP=-1.5,silenceremove=1:0:-50dB:1:0:-50dB[out]");
  });
});

describe("AudioProcessor.extractAudioChunk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ffmpegState.handlers = {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sets ffmpeg start time and duration from the given chunk boundaries", async () => {
    await AudioProcessor.extractAudioChunk("/in.mp3", 8.3, 24, "/out/chunk-1.mp3");

    expect(commandMock.setStartTime).toHaveBeenCalledWith(8.3);
    expect(commandMock.setDuration).toHaveBeenCalledWith(24 - 8.3);
    expect(commandMock.output).toHaveBeenCalledWith("/out/chunk-1.mp3");
    expect(commandMock.run).toHaveBeenCalled();
  });
});
