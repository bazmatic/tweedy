import { describe, expect, it } from "vitest";
import { computeClipOffsets, OVERLAP_SECONDS, ClipTiming } from "./audio-timeline";

describe("computeClipOffsets", () => {
  it("places sequential clips back-to-back when none are interjections", () => {
    const clips: ClipTiming[] = [
      { durationSeconds: 2, isInterjection: false },
      { durationSeconds: 3, isInterjection: false },
      { durationSeconds: 1.5, isInterjection: false },
    ];

    expect(computeClipOffsets(clips)).toEqual([0, 2, 5]);
  });

  it("starts an interjection OVERLAP_SECONDS before the previous clip ends", () => {
    const clips: ClipTiming[] = [
      { durationSeconds: 4, isInterjection: false },
      { durationSeconds: 1, isInterjection: true },
    ];

    expect(computeClipOffsets(clips)).toEqual([0, 4 - OVERLAP_SECONDS]);
  });

  it("resumes the clip after an interjection when the interjection ends, without compounding overlap", () => {
    const clips: ClipTiming[] = [
      { durationSeconds: 4, isInterjection: false },
      { durationSeconds: 1, isInterjection: true },
      { durationSeconds: 3, isInterjection: false },
    ];

    const interjectionOffset = 4 - OVERLAP_SECONDS;
    expect(computeClipOffsets(clips)).toEqual([
      0,
      interjectionOffset,
      interjectionOffset + 1,
    ]);
  });

  it("clamps the interjection offset to zero when the previous clip is shorter than the overlap", () => {
    const clips: ClipTiming[] = [
      { durationSeconds: 0.1, isInterjection: false },
      { durationSeconds: 1, isInterjection: true },
    ];

    expect(computeClipOffsets(clips)).toEqual([0, 0]);
  });

  it("returns an empty array for no clips", () => {
    expect(computeClipOffsets([])).toEqual([]);
  });

  it("keeps the first clip at zero even if it is flagged as an interjection", () => {
    const clips: ClipTiming[] = [
      { durationSeconds: 2, isInterjection: true },
      { durationSeconds: 3, isInterjection: false },
    ];

    expect(computeClipOffsets(clips)).toEqual([0, 2]);
  });

  it("handles consecutive interjections, each overlapping the one before it", () => {
    const clips: ClipTiming[] = [
      { durationSeconds: 4, isInterjection: false },
      { durationSeconds: 1, isInterjection: true },
      { durationSeconds: 1, isInterjection: true },
    ];

    const firstInterjectionOffset = 4 - OVERLAP_SECONDS;
    const secondInterjectionOffset = Math.max(
      0,
      firstInterjectionOffset + 1 - OVERLAP_SECONDS
    );
    expect(computeClipOffsets(clips)).toEqual([
      0,
      firstInterjectionOffset,
      secondInterjectionOffset,
    ]);
  });
});
