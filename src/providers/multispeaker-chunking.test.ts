import { describe, expect, it } from "vitest";
import { chunkTurns } from "./multispeaker-chunking";
import type { MultispeakerTurn } from "../types";

function makeTurn(speakerId: string, text: string): MultispeakerTurn {
  return { speaker: { id: speakerId } as any, voice: {} as any, text };
}

const SPEAKER_CYCLE = ["spA", "spB", "spC"];
function makeCyclingTurn(index: number, text: string): MultispeakerTurn {
  return makeTurn(SPEAKER_CYCLE[index % SPEAKER_CYCLE.length], text);
}

describe("chunkTurns", () => {
  it("returns a single chunk containing all turns when maxTurnsPerChunk is null", () => {
    const turns = [makeCyclingTurn(0, "a"), makeCyclingTurn(1, "b"), makeCyclingTurn(2, "c")];
    expect(chunkTurns(turns, null)).toEqual([turns]);
  });

  it("splits into fixed-size chunks with a smaller remainder chunk at the end", () => {
    const turns = [0, 1, 2, 3, 4].map((i) => makeCyclingTurn(i, "abcde"[i]));
    const chunks = chunkTurns(turns, 2);
    expect(chunks).toEqual([
      [turns[0], turns[1]],
      [turns[2], turns[3]],
      [turns[4]],
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
    expect(chunks).toEqual([[turns[0]], [turns[1]], [turns[2]]]);
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

  describe("single-speaker chunks (a run of consecutive same-speaker turns)", () => {
    it("allows a chunk to end up single-speaker rather than forcing it to merge with a neighbor", () => {
      // A run of same-speaker turns (e.g. a long solo monologue) is left as
      // its own chunk when it hits the turn-count/byte limit — callers are
      // responsible for synthesizing single-speaker chunks differently
      // (see GoogleGeminiMultispeakerProvider.synthesizeChunk), not this
      // function forcing artificial speaker diversity into every chunk.
      const turns = [makeTurn("spA", "hi"), makeTurn("spB", "hey"), makeTurn("spB", "closing thoughts...")];
      const chunks = chunkTurns(turns, 2);
      expect(chunks).toEqual([
        [turns[0], turns[1]],
        [turns[2]],
      ]);
      expect(new Set(chunks[1].map((t) => t.speaker.id)).size).toBe(1);
    });

    it("keeps consecutive same-speaker turns grouped by the byte budget like any other run", () => {
      const turns = [
        makeTurn("spA", "a".repeat(50)),
        makeTurn("spA", "b".repeat(50)),
        makeTurn("spB", "c".repeat(50)),
      ];
      // 100-byte budget fits one 70-byte turn per chunk.
      const chunks = chunkTurns(turns, 8, 100);
      expect(chunks).toEqual([[turns[0]], [turns[1]], [turns[2]]]);
    });
  });
});
