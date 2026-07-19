import ffmpeg from "fluent-ffmpeg";
import type { FfprobeData } from "fluent-ffmpeg";
import * as path from "path";
import * as fs from "fs-extra";
import { logger } from "../utils/logger";
import { computeClipOffsets } from "./audio-timeline";
import type { ClipTiming } from "./audio-timeline";

export interface ConcatenationTiming {
  offsetsSeconds: number[];
  speechEndSeconds: number[];
}

export class AudioProcessor {
  static async processAudio(
    inputPath: string,
    outputPath: string
  ): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(outputPath));

      return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .outputOptions([
            "-af",
            "silenceremove=1:0:-50dB:1:0:-50dB", // Remove silence
            "-af",
            "loudnorm=I=-16:LRA=11:TP=-1.5", // Normalize audio
          ])
          .output(outputPath)
          .on("end", () => {
            logger.debug(`Audio processed: ${outputPath}`);
            resolve();
          })
          .on("error", (error: Error) => {
            logger.error("Audio processing failed:", error);
            reject(error);
          })
          .run();
      });
    } catch (error) {
      logger.error("Failed to process audio:", error);
      throw error;
    }
  }

  static async concatenateAudio(
    inputFiles: string[],
    outputPath: string,
    isInterjection: boolean[] = inputFiles.map(() => false)
  ): Promise<ConcatenationTiming> {
    try {
      await fs.ensureDir(path.dirname(outputPath));

      const speechEnds = await Promise.all(
        inputFiles.map((file) => AudioProcessor.getSpeechEndSeconds(file))
      );

      const clips: ClipTiming[] = speechEnds.map((speechEndSeconds, i) => ({
        speechEndSeconds,
        isInterjection: isInterjection[i] ?? false,
      }));

      const offsets = computeClipOffsets(clips);

      return new Promise((resolve, reject) => {
        const command = ffmpeg();
        inputFiles.forEach((file) => command.input(file));

        const delayedLabels = offsets.map((offsetSeconds, i) => {
          const offsetMs = Math.round(offsetSeconds * 1000);
          const normalizedLabel = `n${i}`;
          const label = `a${i}`;
          return {
            // Normalize each clip individually before mixing so one
            // speaker's voice isn't consistently louder/quieter than
            // another's — the final loudnorm pass only corrects the
            // mixed stream's overall level, not per-speaker imbalance.
            normalizeFilter: `[${i}:a]loudnorm=I=-16:LRA=11:TP=-1.5[${normalizedLabel}]`,
            delayFilter: `[${normalizedLabel}]adelay=${offsetMs}|${offsetMs}[${label}]`,
            label,
          };
        });

        const mixInputs = delayedLabels.map(({ label }) => `[${label}]`).join("");
        const filterGraph = [
          ...delayedLabels.map(({ normalizeFilter }) => normalizeFilter),
          ...delayedLabels.map(({ delayFilter }) => delayFilter),
          // normalize=0: amix defaults to dividing volume by input count, which
          // would quietly attenuate every clip, not just overlapping ones.
          // loudnorm below re-normalizes levels anyway, so skip amix's own scaling.
          `${mixInputs}amix=inputs=${inputFiles.length}:dropout_transition=0:normalize=0[mixed]`,
          // Simple (-af) and complex (-filter_complex) filtering can't target the
          // same output stream, so loudnorm/silenceremove have to be chained onto
          // the end of the complex filtergraph instead of passed as -af.
          "[mixed]loudnorm=I=-16:LRA=11:TP=-1.5,silenceremove=1:0:-50dB:1:0:-50dB[out]",
        ].join(";");

        command
          .complexFilter(filterGraph, "out")
          .output(outputPath)
          .on("end", () => {
            logger.info(`Audio concatenated: ${outputPath}`);
            resolve({ offsetsSeconds: offsets, speechEndSeconds: speechEnds });
          })
          .on("error", (error: Error) => {
            logger.error("Audio concatenation failed:", error);
            reject(error);
          })
          .run();
      });
    } catch (error) {
      logger.error("Failed to concatenate audio:", error);
      throw error;
    }
  }

  static async getAudioDuration(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err: unknown, metadata: FfprobeData) => {
        if (err) {
          reject(err);
        } else {
          resolve(metadata.format.duration || 0);
        }
      });
    });
  }

  /**
   * Returns the timestamp where actual speech content ends, excluding any
   * trailing silence the TTS provider padded the clip with. Falls back to
   * the full file duration if no trailing silence is detected.
   */
  static async getSpeechEndSeconds(
    filePath: string,
    silenceThresholdDb = -40,
    minSilenceDuration = 0.15
  ): Promise<number> {
    const duration = await AudioProcessor.getAudioDuration(filePath);
    const endOfFileEpsilon = 0.05;

    return new Promise((resolve, reject) => {
      const silences: { start: number; end: number | null }[] = [];

      ffmpeg(filePath)
        .audioFilters(
          `silencedetect=noise=${silenceThresholdDb}dB:d=${minSilenceDuration}`
        )
        .format("null")
        .output(process.platform === "win32" ? "NUL" : "/dev/null")
        .on("stderr", (line: string) => {
          const startMatch = line.match(/silence_start:\s*([\d.]+)/);
          if (startMatch) {
            silences.push({ start: parseFloat(startMatch[1]), end: null });
          }

          const endMatch = line.match(/silence_end:\s*([\d.]+)/);
          if (endMatch) {
            const last = silences[silences.length - 1];
            if (last) last.end = parseFloat(endMatch[1]);
          }
        })
        .on("end", () => {
          // A silence segment counts as trailing padding only if it runs
          // through to (approximately) EOF — ffmpeg still reports a
          // silence_end for it, but that end equals the clip's duration
          // rather than marking a point where speech resumes.
          const last = silences[silences.length - 1];
          const isTrailing =
            last != null &&
            (last.end == null || last.end >= duration - endOfFileEpsilon);

          resolve(isTrailing ? last!.start : duration);
        })
        .on("error", (error: Error) => reject(error))
        .run();
    });
  }
}
