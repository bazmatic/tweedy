import ffmpeg from "fluent-ffmpeg";
import type { FfprobeData } from "fluent-ffmpeg";
import * as path from "path";
import * as fs from "fs-extra";
import { logger } from "../utils/logger";
import { computeClipOffsets } from "./audio-timeline";
import type { ClipTiming } from "./audio-timeline";

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
  ): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(outputPath));

      const durations = await Promise.all(
        inputFiles.map((file) => AudioProcessor.getAudioDuration(file))
      );

      const clips: ClipTiming[] = durations.map((durationSeconds, i) => ({
        durationSeconds,
        isInterjection: isInterjection[i] ?? false,
      }));

      const offsets = computeClipOffsets(clips);

      return new Promise((resolve, reject) => {
        const command = ffmpeg();
        inputFiles.forEach((file) => command.input(file));

        const delayedLabels = offsets.map((offsetSeconds, i) => {
          const offsetMs = Math.round(offsetSeconds * 1000);
          const label = `a${i}`;
          return { filter: `[${i}:a]adelay=${offsetMs}|${offsetMs}[${label}]`, label };
        });

        const mixInputs = delayedLabels.map(({ label }) => `[${label}]`).join("");
        const filterGraph = [
          ...delayedLabels.map(({ filter }) => filter),
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
            resolve();
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
}
