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
  /** Leading silence trimmed from the start of each clip, in seconds. */
  leadTrimSeconds: number[];
}

interface LoudnormStats {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

const LOUDNORM_TARGET = "I=-16:LRA=11:TP=-1.5";

export class AudioProcessor {
  /**
   * Single-pass loudnorm measures loudness inline and is unreliable on short
   * or dynamic clips, letting one speaker's voice end up consistently louder
   * even after "normalization". This runs the measurement pass ffmpeg's docs
   * recommend, so the real per-clip normalization pass can apply accurate
   * measured_* values instead of guessing from the same short window.
   */
  static async measureLoudness(filePath: string): Promise<LoudnormStats> {
    return new Promise((resolve, reject) => {
      let stderr = "";
      ffmpeg(filePath)
        .audioFilters(`loudnorm=${LOUDNORM_TARGET}:print_format=json`)
        .format("null")
        .output(process.platform === "win32" ? "NUL" : "/dev/null")
        .on("stderr", (line: string) => {
          stderr += `${line}\n`;
        })
        .on("end", () => {
          const jsonMatch = stderr.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            reject(new Error(`loudnorm measurement pass produced no JSON stats for ${filePath}`));
            return;
          }
          try {
            resolve(JSON.parse(jsonMatch[0]));
          } catch (error) {
            reject(error);
          }
        })
        .on("error", (error: Error) => reject(error))
        .run();
    });
  }

  static loudnormFilterFromStats(stats: LoudnormStats): string {
    return `loudnorm=${LOUDNORM_TARGET}:measured_I=${stats.input_i}:measured_LRA=${stats.input_lra}:measured_TP=${stats.input_tp}:measured_thresh=${stats.input_thresh}:offset=${stats.target_offset}:linear=true:print_format=summary`;
  }

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
    isInterjection: boolean[] = inputFiles.map(() => false),
    isColdOpen: boolean[] = inputFiles.map(() => false)
  ): Promise<ConcatenationTiming> {
    try {
      await fs.ensureDir(path.dirname(outputPath));

      const speechEnds = await Promise.all(
        inputFiles.map((file) => AudioProcessor.getSpeechEndSeconds(file))
      );

      const leadTrims = await Promise.all(
        inputFiles.map((file) => AudioProcessor.getSpeechStartSeconds(file))
      );

      const clips: ClipTiming[] = speechEnds.map((speechEndSeconds, i) => ({
        speechEndSeconds,
        isInterjection: isInterjection[i] ?? false,
        isColdOpen: isColdOpen[i] ?? false,
        leadTrimSeconds: leadTrims[i],
      }));

      const offsets = computeClipOffsets(clips);

      const loudnormStats = await Promise.all(
        inputFiles.map((file) => AudioProcessor.measureLoudness(file))
      );

      return new Promise((resolve, reject) => {
        const command = ffmpeg();
        inputFiles.forEach((file) => command.input(file));

        const delayedLabels = offsets.map((offsetSeconds, i) => {
          const offsetMs = Math.round(offsetSeconds * 1000);
          const trimmedLabel = `t${i}`;
          const normalizedLabel = `n${i}`;
          const label = `a${i}`;
          return {
            // Strip leading silence (dead air the TTS provider padded the
            // clip's start with) before normalizing/delaying, so the next
            // speaker's audible speech starts right after GAP_SECONDS
            // instead of GAP_SECONDS plus however long that padding was.
            trimFilter: `[${i}:a]atrim=start=${leadTrims[i]},asetpts=PTS-STARTPTS[${trimmedLabel}]`,
            // Two-pass normalize each clip individually before mixing so one
            // speaker's voice isn't consistently louder/quieter than
            // another's — the final loudnorm pass only corrects the
            // mixed stream's overall level, not per-speaker imbalance.
            normalizeFilter: `[${trimmedLabel}]${AudioProcessor.loudnormFilterFromStats(loudnormStats[i])}[${normalizedLabel}]`,
            delayFilter: `[${normalizedLabel}]adelay=${offsetMs}|${offsetMs}[${label}]`,
            label,
          };
        });

        const mixInputs = delayedLabels.map(({ label }) => `[${label}]`).join("");
        const filterGraph = [
          ...delayedLabels.map(({ trimFilter }) => trimFilter),
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
            resolve({
              offsetsSeconds: offsets,
              speechEndSeconds: speechEnds,
              leadTrimSeconds: leadTrims,
            });
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

  /**
   * Returns the timestamp where actual speech content begins, excluding any
   * leading silence the TTS provider padded the clip's start with. Returns 0
   * if the clip starts with speech (or has no detectable silence at all).
   */
  static async getSpeechStartSeconds(
    filePath: string,
    silenceThresholdDb = -40,
    minSilenceDuration = 0.15
  ): Promise<number> {
    const startOfFileEpsilon = 0.05;

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
          const first = silences[0];
          const isLeading = first != null && first.start <= startOfFileEpsilon;
          resolve(isLeading && first!.end != null ? first!.end! : 0);
        })
        .on("error", (error: Error) => reject(error))
        .run();
    });
  }

  static async extractAudioChunk(
    inputPath: string,
    startSeconds: number,
    endSeconds: number,
    outputPath: string
  ): Promise<void> {
    await fs.ensureDir(path.dirname(outputPath));

    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .setStartTime(startSeconds)
        .setDuration(endSeconds - startSeconds)
        .output(outputPath)
        .on("end", () => resolve())
        .on("error", (error: Error) => {
          logger.error("Audio chunk extraction failed:", error);
          reject(error);
        })
        .run();
    });
  }
}
