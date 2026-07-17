import ffmpeg from "fluent-ffmpeg";
import { AudioProcessor } from "./AudioProcessor";
import { logger } from "../utils/logger";

export interface TurnBoundary {
  startSeconds: number;
  endSeconds: number;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function evenlyDivide(duration: number, turnCount: number): TurnBoundary[] {
  const step = duration / turnCount;
  return Array.from({ length: turnCount }, (_, i) => ({
    startSeconds: round3(i * step),
    endSeconds: round3((i + 1) * step),
  }));
}

function detectSilenceStarts(
  filePath: string,
  silenceThresholdDb: number,
  minSilenceDuration: number
): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const starts: number[] = [];

    ffmpeg(filePath)
      .audioFilters(`silencedetect=noise=${silenceThresholdDb}dB:d=${minSilenceDuration}`)
      .format("null")
      .output(process.platform === "win32" ? "NUL" : "/dev/null")
      .on("stderr", (line: string) => {
        const match = line.match(/silence_start:\s*([\d.]+)/);
        if (match) starts.push(parseFloat(match[1]));
      })
      .on("end", () => resolve(starts))
      .on("error", (error: Error) => reject(error))
      .run();
  });
}

/**
 * Approximates per-turn boundaries within a single multispeaker-synthesized
 * chunk by locating silence gaps between turns. Falls back to evenly
 * dividing the chunk's duration if the detected gap count doesn't match
 * turnCount - 1 (silencedetect is heuristic and can under/over-count).
 */
export async function splitChunkIntoTurns(
  filePath: string,
  turnCount: number,
  silenceThresholdDb = -40,
  minSilenceDuration = 0.15
): Promise<TurnBoundary[]> {
  const duration = await AudioProcessor.getAudioDuration(filePath);

  if (turnCount <= 1) {
    return [{ startSeconds: 0, endSeconds: duration }];
  }

  const silenceStarts = await detectSilenceStarts(filePath, silenceThresholdDb, minSilenceDuration);

  if (silenceStarts.length !== turnCount - 1) {
    logger.warn(
      `Detected ${silenceStarts.length} silence gap(s) in ${filePath} but expected ${turnCount - 1} for ${turnCount} turns; falling back to even division`
    );
    return evenlyDivide(duration, turnCount);
  }

  const boundaries: TurnBoundary[] = [];
  let start = 0;
  for (const gapStart of silenceStarts) {
    boundaries.push({ startSeconds: round3(start), endSeconds: round3(gapStart) });
    start = gapStart;
  }
  boundaries.push({ startSeconds: round3(start), endSeconds: round3(duration) });
  return boundaries;
}
