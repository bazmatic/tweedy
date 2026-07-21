import { describe, expect, it } from "vitest";
import { computeChunkBoundaries } from "./timeline-chunking";
import type { TimelineEntry } from "../services/AudioService";

function entry(startSeconds: number, endSeconds: number, speechId: string): TimelineEntry {
  return {
    speechId,
    speakerId: "sp1",
    speakerName: "Alex",
    message: "text",
    tool: undefined,
    isInterjection: false,
    startSeconds,
    endSeconds,
  };
}

describe("computeChunkBoundaries", () => {
  it("puts everything in one chunk when total duration is under the cap", () => {
    const entries = [entry(0, 10, "s1"), entry(10.3, 20, "s2")];

    const chunks = computeChunkBoundaries(entries, 100);

    expect(chunks).toEqual([{ startSeconds: 0, endSeconds: 20, entryIndices: [0, 1] }]);
  });

  it("starts a new chunk before an entry that would push the current chunk over the cap", () => {
    const entries = [entry(0, 8, "s1"), entry(8.3, 16, "s2"), entry(16.3, 24, "s3")];

    const chunks = computeChunkBoundaries(entries, 15);

    expect(chunks).toEqual([
      { startSeconds: 0, endSeconds: 8, entryIndices: [0] },
      { startSeconds: 8.3, endSeconds: 24, entryIndices: [1, 2] },
    ]);
  });

  it("never splits a single entry across chunks even if it alone exceeds the cap", () => {
    const entries = [entry(0, 50, "s1"), entry(50.3, 60, "s2")];

    const chunks = computeChunkBoundaries(entries, 10);

    expect(chunks).toEqual([
      { startSeconds: 0, endSeconds: 50, entryIndices: [0] },
      { startSeconds: 50.3, endSeconds: 60, entryIndices: [1] },
    ]);
  });

  it("returns an empty array for no entries", () => {
    expect(computeChunkBoundaries([], 100)).toEqual([]);
  });
});
