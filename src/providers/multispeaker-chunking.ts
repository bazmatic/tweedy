import { MultispeakerTurn } from "../types";

export function chunkTurns(
  turns: MultispeakerTurn[],
  maxTurnsPerChunk: number | null
): MultispeakerTurn[][] {
  if (turns.length === 0) return [];
  if (maxTurnsPerChunk == null) return [turns];

  const chunks: MultispeakerTurn[][] = [];
  for (let i = 0; i < turns.length; i += maxTurnsPerChunk) {
    chunks.push(turns.slice(i, i + maxTurnsPerChunk));
  }
  return chunks;
}
