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
});
