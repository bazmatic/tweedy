import { MultispeakerTurn } from "../types";

// Accounts for the "SpeakerN: " alias prefix and newline each turn gets
// wrapped in when a provider joins turns into one text field (see
// GoogleGeminiMultispeakerProvider.synthesizeChunk) — chunk byte budgets
// are enforced on that joined text, not raw turn.text alone.
const PER_TURN_OVERHEAD_BYTES = 20;

function turnByteSize(turn: MultispeakerTurn): number {
  return Buffer.byteLength(turn.text, "utf8") + PER_TURN_OVERHEAD_BYTES;
}

/**
 * Splits turns into chunks bounded by whichever of maxTurnsPerChunk /
 * maxBytesPerChunk is hit first. A single turn that alone exceeds
 * maxBytesPerChunk is still placed in its own chunk (turns are never
 * split) — that chunk may still fail synthesis; there's no shorter form
 * to fall back to short of truncating dialogue.
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
  return chunks;
}
