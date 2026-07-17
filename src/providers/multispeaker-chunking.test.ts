import { describe, expect, it } from "vitest";
import { chunkTurns } from "./multispeaker-chunking";
import type { MultispeakerTurn } from "../types";

function makeTurn(speakerId: string, text: string): MultispeakerTurn {
  return { speaker: { id: speakerId } as any, voice: {} as any, text };
}

// Cycling through 3 speakers means any 2+-turn chunk boundary lands on at
// least 2 distinct speakers, so the single-speaker merge pass never
// triggers — keeps these tests focused purely on count/byte splitting.
const SPEAKER_CYCLE = ["spA", "spB", "spC"];
function makeCyclingTurn(index: number, text: string): MultispeakerTurn {
  return makeTurn(SPEAKER_CYCLE[index % SPEAKER_CYCLE.length], text);
}

describe("chunkTurns", () => {
  it("returns a single chunk containing all turns when maxTurnsPerChunk is null", () => {
    const turns = [makeCyclingTurn(0, "a"), makeCyclingTurn(1, "b"), makeCyclingTurn(2, "c")];
    expect(chunkTurns(turns, null)).toEqual([turns]);
  });

  it("splits into fixed-size chunks, merging a single-speaker remainder into the preceding chunk", () => {
    const turns = [0, 1, 2, 3, 4].map((i) => makeCyclingTurn(i, "abcde"[i]));
    const chunks = chunkTurns(turns, 2);
    // Turn-count splitting alone would leave turns[4] (speaker B) in its
    // own trailing chunk; since that chunk would be single-speaker, it
    // merges into the preceding [C, A] chunk instead.
    expect(chunks).toEqual([
      [turns[0], turns[1]],
      [turns[2], turns[3], turns[4]],
    ]);
  });

  it("returns an empty array for empty input", () => {
    expect(chunkTurns([], 3)).toEqual([]);
  });

  it("closes a chunk early at a byte boundary that doesn't align with maxTurnsPerChunk", () => {
    const turns = [0, 1, 2, 3].map((i) => makeCyclingTurn(i, "abcd"[i].repeat(50)));
    // Each turn is 50 + 20 (overhead) = 70 bytes. maxTurnsPerChunk=8 would
    // never force a split on its own; the 150-byte budget forces one at
    // every 2 turns (140 bytes) instead of waiting for the turn-count cap.
    const chunks = chunkTurns(turns, 8, 150);
    expect(chunks).toEqual([
      [turns[0], turns[1]],
      [turns[2], turns[3]],
    ]);
  });

  it("never splits a turn's text even when it alone exceeds maxBytesPerChunk", () => {
    const turns = [makeCyclingTurn(0, "a".repeat(50)), makeCyclingTurn(1, "b".repeat(500)), makeCyclingTurn(2, "c")];
    const chunks = chunkTurns(turns, 8, 100);
    // Byte-splitting alone would isolate each turn into its own chunk here,
    // but every one of those chunks is single-speaker, so the merge pass
    // (tested below) collapses them back into one — the key invariant this
    // test protects is that turns[1]'s 500-char text appears whole and
    // unmodified, never truncated or divided across chunks.
    expect(chunks.flat()).toEqual(turns);
    expect(chunks.flat().find((t) => t.text === turns[1].text)).toBeDefined();
  });

  it("still respects maxTurnsPerChunk when the byte budget alone would allow more turns", () => {
    const turns = [0, 1, 2, 3].map((i) => makeCyclingTurn(i, "abcd"[i]));
    const chunks = chunkTurns(turns, 2, 10_000);
    expect(chunks).toEqual([
      [turns[0], turns[1]],
      [turns[2], turns[3]],
    ]);
  });

  it("treats maxBytesPerChunk of null as no byte limit (turn-count-only behavior unchanged)", () => {
    const turns = [makeCyclingTurn(0, "a".repeat(5000)), makeCyclingTurn(1, "b".repeat(5000))];
    const chunks = chunkTurns(turns, 8, null);
    expect(chunks).toEqual([turns]);
  });

  describe("single-speaker chunk merging", () => {
    it("merges a trailing single-speaker chunk (e.g. a long solo closing monologue) into the preceding chunk", () => {
      // spA, spB fit in chunk 1 under maxTurnsPerChunk=2; a solo spB closer
      // would otherwise land alone in its own chunk.
      const turns = [makeTurn("spA", "hi"), makeTurn("spB", "hey"), makeTurn("spB", "closing thoughts...")];
      const chunks = chunkTurns(turns, 2);
      expect(chunks).toEqual([turns]);
      expect(chunks.every((chunk) => new Set(chunk.map((t) => t.speaker.id)).size >= 2)).toBe(true);
    });

    it("merges a leading single-speaker chunk forward into the next chunk", () => {
      const turns = [
        makeTurn("spA", "cold open line one"),
        makeTurn("spA", "cold open line two"),
        makeTurn("spB", "hi back"),
      ];
      const chunks = chunkTurns(turns, 2);
      expect(chunks).toEqual([turns]);
    });

    it("cascades merges across multiple consecutive single-speaker chunks until 2 distinct speakers are present", () => {
      const turns = [
        makeTurn("spA", "a".repeat(50)),
        makeTurn("spA", "b".repeat(50)),
        makeTurn("spB", "c".repeat(50)),
      ];
      // Byte budget forces each turn into its own chunk before merging.
      const chunks = chunkTurns(turns, 8, 100);
      expect(chunks).toEqual([turns]);
    });

    it("leaves already-multi-speaker chunks alone", () => {
      const turns = [0, 1, 2, 3].map((i) => makeCyclingTurn(i, "abcd"[i]));
      const chunks = chunkTurns(turns, 2);
      expect(chunks).toEqual([
        [turns[0], turns[1]],
        [turns[2], turns[3]],
      ]);
    });

    it("every chunk chunkTurns returns has at least 2 distinct speakers whenever the input as a whole does", () => {
      const turns = [
        makeTurn("spA", "x".repeat(30)),
        makeTurn("spB", "y".repeat(30)),
        makeTurn("spB", "z".repeat(30)),
        makeTurn("spB", "very long closing monologue ".repeat(20)),
      ];
      const chunks = chunkTurns(turns, 2, 200);
      for (const chunk of chunks) {
        expect(new Set(chunk.map((t) => t.speaker.id)).size).toBeGreaterThanOrEqual(2);
      }
    });
  });
});
