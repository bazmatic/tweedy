import type { TimelineEntry } from "../services/AudioService";

/** Duration proxy for the Whisper API's 25MB upload cap: at typical podcast
 * mp3 bitrates (~128kbps), 20 minutes stays comfortably under the limit. */
export const MAX_CHUNK_SECONDS = 20 * 60;

export interface TimelineChunkBoundary {
  startSeconds: number;
  endSeconds: number;
  entryIndices: number[];
}

/**
 * Groups consecutive entries into chunks no longer than maxChunkSeconds,
 * without ever splitting a single entry across two chunks.
 */
export function computeChunkBoundaries(
  entries: TimelineEntry[],
  maxChunkSeconds: number = MAX_CHUNK_SECONDS
): TimelineChunkBoundary[] {
  if (entries.length === 0) return [];

  const chunks: TimelineChunkBoundary[] = [];
  let chunkStart = entries[0].startSeconds;
  let chunkEnd = entries[0].endSeconds;
  let chunkIndices: number[] = [0];
  let justStartedChunk = false;

  for (let i = 1; i < entries.length; i++) {
    const entry = entries[i];
    const wouldBeDuration = entry.endSeconds - chunkStart;

    if (wouldBeDuration > maxChunkSeconds) {
      if (justStartedChunk) {
        // We just started this chunk, so give it a free pass for this entry
        chunkEnd = entry.endSeconds;
        chunkIndices.push(i);
        justStartedChunk = false;
      } else {
        // End current chunk and start a new one
        chunks.push({ startSeconds: chunkStart, endSeconds: chunkEnd, entryIndices: chunkIndices });
        chunkStart = entry.startSeconds;
        chunkEnd = entry.endSeconds;
        chunkIndices = [i];
        justStartedChunk = true;
      }
    } else {
      chunkEnd = entry.endSeconds;
      chunkIndices.push(i);
      justStartedChunk = false;
    }
  }

  chunks.push({ startSeconds: chunkStart, endSeconds: chunkEnd, entryIndices: chunkIndices });
  return chunks;
}
