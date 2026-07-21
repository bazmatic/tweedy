import * as os from "os";
import * as path from "path";
import * as fs from "fs-extra";
import { AudioProcessor } from "../providers/AudioProcessor";
import { TranscriptionProviderFactory } from "../providers/TranscriptionProviderFactory";
import { computeChunkBoundaries, MAX_CHUNK_SECONDS } from "../providers/timeline-chunking";
import { alignWordsToEntries } from "../providers/timeline-word-alignment";
import { TranscriptionProviderName, WordTimestamp } from "../types";
import { logger } from "../utils/logger";
import type { Timeline } from "./AudioService";

export class TimelineRefinementService {
  /**
   * Refines a timeline's entry boundaries and word timestamps by
   * transcribing the episode audio with Whisper and sequentially aligning
   * the result back onto each entry's known text. Never throws: any
   * transcription failure logs a warning and returns the original timeline
   * unchanged, so refinement is a pure enhancement, never a point of
   * failure for a generate/refine-timeline run.
   */
  static async refineTimeline(
    audioFile: string,
    timeline: Timeline,
    maxChunkSeconds: number = MAX_CHUNK_SECONDS
  ): Promise<Timeline> {
    const boundaries = computeChunkBoundaries(timeline.entries, maxChunkSeconds);
    if (boundaries.length === 0) return timeline;

    // Resolve the provider before entering the try/catch below: a missing
    // OPENAI_API_KEY throws synchronously here and is a config problem, not
    // a runtime transcription failure, so it must propagate out of this
    // method rather than being swallowed into the generic fallback path.
    const provider = TranscriptionProviderFactory.getProvider(
      TranscriptionProviderName.OpenAIWhisper
    );

    const tempDir = path.join(
      os.tmpdir(),
      `tweedy-whisper-${path.basename(audioFile)}-${process.pid}-${Math.random().toString(36).slice(2)}`
    );
    await fs.ensureDir(tempDir);

    try {
      const allWords: WordTimestamp[] = [];

      for (let i = 0; i < boundaries.length; i++) {
        const chunk = boundaries[i];
        const chunkPath = path.join(tempDir, `chunk-${i}.mp3`);

        await AudioProcessor.extractAudioChunk(
          audioFile,
          chunk.startSeconds,
          chunk.endSeconds,
          chunkPath
        );

        const { words } = await provider.transcribe(chunkPath);
        for (const word of words) {
          allWords.push({
            word: word.word,
            startSeconds: word.startSeconds + chunk.startSeconds,
            endSeconds: word.endSeconds + chunk.startSeconds,
          });
        }
      }

      const refinedEntries = alignWordsToEntries(timeline.entries, allWords);
      return { ...timeline, entries: refinedEntries };
    } catch (error) {
      logger.warn(
        `Timeline refinement failed, keeping original approximate timeline: ${error}`
      );
      return timeline;
    } finally {
      await fs.remove(tempDir);
    }
  }
}
