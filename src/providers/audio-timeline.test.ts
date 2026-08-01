import { describe, expect, it } from "vitest";
import {
  COLD_OPEN_GAP_SECONDS,
  computeClipOffsets,
  GAP_SECONDS,
  OVERLAP_SECONDS,
} from "./audio-timeline";
import type { ClipTiming } from "./audio-timeline";

describe("computeClipOffsets", () => {
  it("places sequential clips back-to-back with a gap when none are interjections", () => {
    const clips: ClipTiming[] = [
      { speechEndSeconds: 2, isInterjection: false },
      { speechEndSeconds: 3, isInterjection: false },
      { speechEndSeconds: 1.5, isInterjection: false },
    ];

    expect(computeClipOffsets(clips)).toEqual([
      0,
      2 + GAP_SECONDS,
      2 + GAP_SECONDS + 3 + GAP_SECONDS,
    ]);
  });

  it("starts an interjection OVERLAP_SECONDS before the previous clip's speech ends", () => {
    const clips: ClipTiming[] = [
      { speechEndSeconds: 4, isInterjection: false },
      { speechEndSeconds: 1, isInterjection: true },
    ];

    expect(computeClipOffsets(clips)).toEqual([0, 4 - OVERLAP_SECONDS]);
  });

  it("resumes the clip after an interjection when the interjection's speech ends, without compounding overlap", () => {
    const clips: ClipTiming[] = [
      { speechEndSeconds: 4, isInterjection: false },
      { speechEndSeconds: 1, isInterjection: true },
      { speechEndSeconds: 3, isInterjection: false },
    ];

    const interjectionOffset = 4 - OVERLAP_SECONDS;
    expect(computeClipOffsets(clips)).toEqual([
      0,
      interjectionOffset,
      interjectionOffset + 1 + GAP_SECONDS,
    ]);
  });

  it("never produces a negative offset, even for a very short previous clip", () => {
    const clips: ClipTiming[] = [
      { speechEndSeconds: 0.1, isInterjection: false },
      { speechEndSeconds: 1, isInterjection: true },
    ];

    expect(computeClipOffsets(clips)).toEqual([0, 0.1]);
  });

  it("returns an empty array for no clips", () => {
    expect(computeClipOffsets([])).toEqual([]);
  });

  it("keeps the first clip at zero even if it is flagged as an interjection", () => {
    const clips: ClipTiming[] = [
      { speechEndSeconds: 2, isInterjection: true },
      { speechEndSeconds: 3, isInterjection: false },
    ];

    expect(computeClipOffsets(clips)).toEqual([0, 2 + GAP_SECONDS]);
  });

  it("handles consecutive interjections, each overlapping the one before it", () => {
    const clips: ClipTiming[] = [
      { speechEndSeconds: 4, isInterjection: false },
      { speechEndSeconds: 1, isInterjection: true },
      { speechEndSeconds: 1, isInterjection: true },
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

  it("gives the clip after a cold open a longer natural pause than the standard gap", () => {
    const clips: ClipTiming[] = [
      { speechEndSeconds: 5, isInterjection: false, isColdOpen: true },
      { speechEndSeconds: 3, isInterjection: false },
    ];

    expect(COLD_OPEN_GAP_SECONDS).toBeGreaterThan(GAP_SECONDS);
    expect(computeClipOffsets(clips)).toEqual([0, 5 + COLD_OPEN_GAP_SECONDS]);
  });

  it("uses the standard gap between two ordinary clips when neither is a cold open", () => {
    const clips: ClipTiming[] = [
      { speechEndSeconds: 5, isInterjection: false, isColdOpen: false },
      { speechEndSeconds: 3, isInterjection: false },
    ];

    expect(computeClipOffsets(clips)).toEqual([0, 5 + GAP_SECONDS]);
  });

  it("still overlaps an interjection immediately after a cold open, ignoring the cold-open gap", () => {
    const clips: ClipTiming[] = [
      { speechEndSeconds: 5, isInterjection: false, isColdOpen: true },
      { speechEndSeconds: 1, isInterjection: true },
    ];

    expect(computeClipOffsets(clips)).toEqual([0, 5 - OVERLAP_SECONDS]);
  });
});
