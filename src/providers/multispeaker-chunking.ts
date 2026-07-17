import { MultispeakerTurn } from "../types";

// Accounts for the "SpeakerN: " alias prefix and newline each turn gets
// wrapped in when a provider joins turns into one text field (see
// GoogleGeminiMultispeakerProvider.synthesizeChunk) — chunk byte budgets
// are enforced on that joined text, not raw turn.text alone.
const PER_TURN_OVERHEAD_BYTES = 20;

function turnByteSize(turn: MultispeakerTurn): number {
  return Buffer.byteLength(turn.text, "utf8") + PER_TURN_OVERHEAD_BYTES;
}

function distinctSpeakerCount(chunk: MultispeakerTurn[]): number {
  return new Set(chunk.map((turn) => turn.speaker.id)).size;
}

/**
 * Google's multi-speaker synthesis endpoint rejects any call whose turns
 * come from a single speaker ("Multi-speaker synthesis requires two
 * distinct speakers."). A long solo turn can end up alone in its own
 * chunk after count/byte splitting (e.g. a closing monologue that alone
 * exceeds maxBytesPerChunk, or that simply lands at a chunk boundary) —
 * this merges any single-speaker chunk into an adjacent chunk so every
 * chunk that goes out for synthesis has at least 2 distinct speakers.
 * Merging can push a chunk back over maxTurnsPerChunk/maxBytesPerChunk;
 * that's accepted the same way a single oversized turn is — Google's hard
 * 2-speaker requirement wins over the soft size budgets.
 */
function mergeSingleSpeakerChunks(chunks: MultispeakerTurn[][]): MultispeakerTurn[][] {
  if (chunks.length <= 1) return chunks;

  const merged: MultispeakerTurn[][] = [];
  for (const chunk of chunks) {
    if (distinctSpeakerCount(chunk) < 2 && merged.length > 0) {
      merged[merged.length - 1] = merged[merged.length - 1].concat(chunk);
    } else {
      merged.push(chunk);
    }
  }

  // A single-speaker chunk with nothing before it (i.e. it's still first)
  // can't merge backward in the loop above — merge it forward instead.
  if (merged.length > 1 && distinctSpeakerCount(merged[0]) < 2) {
    merged[1] = merged[0].concat(merged[1]);
    merged.shift();
  }

  return merged;
}

/**
 * Splits turns into chunks bounded by whichever of maxTurnsPerChunk /
 * maxBytesPerChunk is hit first, then merges any resulting single-speaker
 * chunk into an adjacent one (see mergeSingleSpeakerChunks). A single turn
 * that alone exceeds maxBytesPerChunk is still placed in its own chunk
 * (turns are never split) — that chunk may still fail synthesis; there's
 * no shorter form to fall back to short of truncating dialogue.
 */
export function chunkTurns(
  turns: MultispeakerTurn[],
  maxTurnsPerChunk: number | null,
  maxBytesPerChunk: number | null = null
): MultispeakerTurn[][] {
  if (turns.length === 0) return [];
  if (maxTurnsPerChunk == null && maxBytesPerChunk == null) return [turns];

  const chunks: MultispeakerTurn[][] = [];
  let current: MultispeakerTurn[] = [];
  let currentBytes = 0;

  for (const turn of turns) {
    const turnBytes = turnByteSize(turn);
    const exceedsTurnCount = maxTurnsPerChunk != null && current.length >= maxTurnsPerChunk;
    const exceedsByteBudget =
      maxBytesPerChunk != null && current.length > 0 && currentBytes + turnBytes > maxBytesPerChunk;

    if (current.length > 0 && (exceedsTurnCount || exceedsByteBudget)) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }

    current.push(turn);
    currentBytes += turnBytes;
  }

  if (current.length > 0) chunks.push(current);
  return mergeSingleSpeakerChunks(chunks);
}
