import { VocalProviderFactory, AudioProcessor } from "../providers";
import { Speech, TtsResult, WordTimestamp } from "../types";
import { logger } from "../utils/logger";
import { SpeakerAgentToolName } from "../agents/speaker-tools";
import { appConfig } from "../utils/config";
import * as path from "path";
import * as fs from "fs-extra";

export interface IAudioService {
  generateAudio(
    speeches: Speech[],
    outputPath: string,
    scriptId?: string
  ): Promise<string>;
  regenerateSpeech(
    speeches: Speech[],
    speechId: string,
    outputPath: string,
    scriptId?: string
  ): Promise<string>;
  processAudioFile(inputPath: string, outputPath: string): Promise<void>;
}

interface TimelineEntry {
  speechId: string;
  speakerId: string;
  speakerName: string;
  speakerAppearance?: string;
  message: string;
  tool: SpeakerAgentToolName | undefined;
  isInterjection: boolean;
  startSeconds: number;
  endSeconds: number;
  wordTimestamps?: WordTimestamp[];
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function timelinePathFor(outputPath: string): string {
  const dir = path.dirname(outputPath);
  const base = path.basename(outputPath, path.extname(outputPath));
  return path.join(dir, `${base}.timeline.json`);
}

export class AudioService implements IAudioService {
  async generateAudio(
    speeches: Speech[],
    outputPath: string,
    scriptId?: string
  ): Promise<string> {
    try {
      logger.info(`Generating audio for ${speeches.length} speeches`);

      const ttsResults: TtsResult[] = [];
      const batchSize = 1;

      // Process speeches in batches
      for (let i = 0; i < speeches.length; i += batchSize) {
        const batch = speeches.slice(i, i + batchSize);
        const batchPromises = batch.map((speech, batchIndex) => {
          const index = i + batchIndex;
          return this.generateSpeechAudio(
            speech,
            speeches[index - 1]?.message,
            speeches[index + 1]?.message
          );
        });
        const batchResults = await Promise.all(batchPromises);
        ttsResults.push(...batchResults);
      }

      const audioFiles = ttsResults.map((result) => result.outputPath);

      const isInterjection = speeches.map(
        (speech) => speech.tool === SpeakerAgentToolName.INTERJECT
      );

      // Concatenate all audio files, overlapping interjections with the
      // preceding clip so they sound like a natural cut-in.
      const timing = await AudioProcessor.concatenateAudio(
        audioFiles,
        outputPath,
        isInterjection
      );

      await this.writeTimeline(speeches, ttsResults, timing, outputPath, scriptId);

      logger.success(`Audio generated: ${outputPath}`);
      return outputPath;
    } catch (error) {
      logger.error("Failed to generate audio:", error);
      throw error;
    }
  }

  /**
   * Re-synthesizes a single speech (e.g. after a text edit to fix a
   * mispronunciation) and re-splices the full track from cached per-speech
   * clips, instead of re-running TTS for every line. Word timestamps for
   * unchanged speeches are recovered from the existing timeline.json rather
   * than re-fetched, since their audio files are untouched.
   */
  async regenerateSpeech(
    speeches: Speech[],
    speechId: string,
    outputPath: string,
    scriptId?: string
  ): Promise<string> {
    try {
      const index = speeches.findIndex((s) => s.id === speechId);
      if (index === -1) {
        throw new Error(`Speech ${speechId} not found in script`);
      }

      const previousWordTimestampsById = await this.loadCachedWordTimestamps(
        outputPath
      );

      logger.info(`Regenerating audio for speech ${speechId}`);
      const freshResult = await this.generateSpeechAudio(
        speeches[index],
        speeches[index - 1]?.message,
        speeches[index + 1]?.message
      );

      const ttsResults: TtsResult[] = speeches.map((speech) => {
        if (speech.id === speechId) {
          return freshResult;
        }
        return {
          outputPath: path.join(
            appConfig.audioDir,
            "speeches",
            `${speech.id}.mp3`
          ),
          wordTimestamps: previousWordTimestampsById.get(speech.id),
        };
      });

      const audioFiles = ttsResults.map((result) => result.outputPath);
      const isInterjection = speeches.map(
        (speech) => speech.tool === SpeakerAgentToolName.INTERJECT
      );

      const timing = await AudioProcessor.concatenateAudio(
        audioFiles,
        outputPath,
        isInterjection
      );

      await this.writeTimeline(speeches, ttsResults, timing, outputPath, scriptId);

      logger.success(`Audio regenerated: ${outputPath}`);
      return outputPath;
    } catch (error) {
      logger.error("Failed to regenerate speech audio:", error);
      throw error;
    }
  }

  /** Recovers per-clip-relative word timestamps from an existing timeline.json,
   * keyed by speechId, so unchanged clips don't need to hit the TTS provider
   * again just to re-derive data their untouched audio file already implies. */
  private async loadCachedWordTimestamps(
    outputPath: string
  ): Promise<Map<string, WordTimestamp[]>> {
    const timelinePath = timelinePathFor(outputPath);
    const result = new Map<string, WordTimestamp[]>();

    if (!(await fs.pathExists(timelinePath))) {
      return result;
    }

    const timeline = await fs.readJson(timelinePath);
    for (const entry of timeline.entries ?? []) {
      if (!entry.wordTimestamps?.length) continue;
      const clipStart = entry.startSeconds;
      result.set(
        entry.speechId,
        entry.wordTimestamps.map((w: WordTimestamp) => ({
          word: w.word,
          startSeconds: round3(w.startSeconds - clipStart),
          endSeconds: round3(w.endSeconds - clipStart),
        }))
      );
    }

    return result;
  }

  async processAudioFile(inputPath: string, outputPath: string): Promise<void> {
    try {
      await AudioProcessor.processAudio(inputPath, outputPath);
      logger.info(`Audio processed: ${outputPath}`);
    } catch (error) {
      logger.error("Failed to process audio file:", error);
      throw error;
    }
  }

  private async writeTimeline(
    speeches: Speech[],
    ttsResults: TtsResult[],
    timing: { offsetsSeconds: number[]; speechEndSeconds: number[] },
    outputPath: string,
    scriptId?: string
  ): Promise<void> {
    const entries: TimelineEntry[] = speeches.map((speech, i) => {
      const startSeconds = round3(timing.offsetsSeconds[i]);
      const wordTimestamps = ttsResults[i].wordTimestamps?.map((w) => ({
        word: w.word,
        startSeconds: round3(startSeconds + w.startSeconds),
        endSeconds: round3(startSeconds + w.endSeconds),
      }));

      return {
        speechId: speech.id,
        speakerId: speech.speaker.id,
        speakerName: speech.speaker.name,
        ...(speech.speaker.physicalAppearance
          ? { speakerAppearance: speech.speaker.physicalAppearance }
          : {}),
        message: speech.message,
        tool: speech.tool,
        isInterjection: speech.tool === SpeakerAgentToolName.INTERJECT,
        startSeconds,
        endSeconds: round3(timing.offsetsSeconds[i] + timing.speechEndSeconds[i]),
        ...(wordTimestamps?.length ? { wordTimestamps } : {}),
      };
    });

    const timelinePath = timelinePathFor(outputPath);
    await fs.writeJson(
      timelinePath,
      {
        ...(scriptId !== undefined ? { scriptId } : {}),
        audioFile: outputPath,
        entries,
      },
      { spaces: 2 }
    );
    logger.info(`Audio timeline written: ${timelinePath}`);
  }

  private async generateSpeechAudio(
    speech: Speech,
    previousText?: string,
    nextText?: string
  ): Promise<TtsResult> {
    const provider = VocalProviderFactory.getProvider(speech.voice.provider);
    const outputFileName = path.join("speeches", `${speech.id}.mp3`);

    return provider.tts({
      speech,
      voice: speech.voice,
      outputFileName,
      previousText,
      nextText,
    });
  }
}
