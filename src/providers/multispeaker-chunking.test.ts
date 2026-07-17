import { describe, expect, it } from "vitest";
import { chunkTurns } from "./multispeaker-chunking";
import type { MultispeakerTurn } from "../types";

function makeTurn(text: string): MultispeakerTurn {
  return { speaker: { id: "sp1" } as any, voice: {} as any, text };
}

describe("chunkTurns", () => {
  it("returns a single chunk containing all turns when maxTurnsPerChunk is null", () => {
    const turns = [makeTurn("a"), makeTurn("b"), makeTurn("c")];
    expect(chunkTurns(turns, null)).toEqual([turns]);
  });

  it("splits into fixed-size chunks with a smaller remainder chunk at the end", () => {
    const turns = [makeTurn("a"), makeTurn("b"), makeTurn("c"), makeTurn("d"), makeTurn("e")];
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

  it("closes a chunk early when the next turn would exceed maxBytesPerChunk, even under maxTurnsPerChunk", () => {
    const turns = [makeTurn("a".repeat(50)), makeTurn("b".repeat(50)), makeTurn("c".repeat(50))];
    // Each turn is 50 + 20 (overhead) = 70 bytes. A budget of 100 fits one
    // turn per chunk with room to spare but not two.
    const chunks = chunkTurns(turns, 8, 100);
    expect(chunks).toEqual([[turns[0]], [turns[1]], [turns[2]]]);
  });

  it("packs multiple turns into a chunk while they fit the byte budget", () => {
    const turns = [makeTurn("a".repeat(50)), makeTurn("b".repeat(50)), makeTurn("c".repeat(50))];
    // Each turn is 70 bytes; a 150-byte budget fits two turns (140) but not three (210).
    const chunks = chunkTurns(turns, 8, 150);
    expect(chunks).toEqual([[turns[0], turns[1]], [turns[2]]]);
  });

  it("places a single turn that alone exceeds maxBytesPerChunk into its own chunk rather than splitting it", () => {
    const turns = [makeTurn("a".repeat(50)), makeTurn("b".repeat(500))];
    const chunks = chunkTurns(turns, 8, 100);
    expect(chunks).toEqual([[turns[0]], [turns[1]]]);
  });

  it("still respects maxTurnsPerChunk when the byte budget alone would allow more turns", () => {
    const turns = [makeTurn("a"), makeTurn("b"), makeTurn("c")];
    const chunks = chunkTurns(turns, 2, 10_000);
    expect(chunks).toEqual([[turns[0], turns[1]], [turns[2]]]);
  });

  it("treats maxBytesPerChunk of null as no byte limit (turn-count-only behavior unchanged)", () => {
    const turns = [makeTurn("a".repeat(5000)), makeTurn("b".repeat(5000))];
    const chunks = chunkTurns(turns, 8, null);
    expect(chunks).toEqual([turns]);
  });
});
