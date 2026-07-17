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

/**
 * Divides duration across turns proportionally to each turn's text length,
 * rather than splitting it evenly — an even split badly misrepresents
 * turns of very different lengths (e.g. a 6-word reaction next to a
 * 120-word explanation would otherwise get the same on-screen duration).
 */
function divideProportionally(duration: number, turnTextLengths: number[]): TurnBoundary[] {
  const totalLength = turnTextLengths.reduce((sum, len) => sum + len, 0);
  const boundaries: TurnBoundary[] = [];
  let cursor = 0;

  for (const length of turnTextLengths) {
    const share = totalLength > 0 ? length / totalLength : 1 / turnTextLengths.length;
    const end = cursor + duration * share;
    boundaries.push({ startSeconds: round3(cursor), endSeconds: round3(end) });
    cursor = end;
  }

  // Rounding can leave the last boundary a hair short of/past the real
  // duration; snap it exactly so downstream offset math isn't thrown off.
  boundaries[boundaries.length - 1].endSeconds = round3(duration);
  return boundaries;
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
 * chunk by locating silence gaps between turns. Falls back to dividing the
 * chunk's duration proportionally by each turn's text length if the
 * detected gap count doesn't match turnTextLengths.length - 1
 * (silencedetect is heuristic and can under/over-count).
 */
export async function splitChunkIntoTurns(
  filePath: string,
  turnTextLengths: number[],
  silenceThresholdDb = -40,
  minSilenceDuration = 0.15
): Promise<TurnBoundary[]> {
  const duration = await AudioProcessor.getAudioDuration(filePath);
  const turnCount = turnTextLengths.length;

  if (turnCount <= 1) {
    return [{ startSeconds: 0, endSeconds: duration }];
  }

  const silenceStarts = await detectSilenceStarts(filePath, silenceThresholdDb, minSilenceDuration);

  if (silenceStarts.length !== turnCount - 1) {
    logger.warn(
      `Detected ${silenceStarts.length} silence gap(s) in ${filePath} but expected ${turnCount - 1} for ${turnCount} turns; falling back to proportional-by-text-length division`
    );
    return divideProportionally(duration, turnTextLengths);
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
