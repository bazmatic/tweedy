import { promises as fs } from "fs";
import { createScorer } from "@mastra/core/evals";
import { TweedyTrace } from "../tracing";
import type { ExperimentRunInput, ExperimentRunOutput } from "./experiment-workflow";

export interface RejectionRepairCounts {
  /** Count of traces with outcome === "proposed" (one per real turn-selection attempt). */
  totalAttempts: number;
  failedCount: number;
  repairedCount: number;
}

export interface RejectionRepairRateResult {
  score: number;
  reason: string;
  counts: RejectionRepairCounts;
}

export function computeRejectionRepairRate(
  traces: TweedyTrace[],
  episodeId: string,
  runId: string
): RejectionRepairRateResult {
  const relevant = traces.filter(
    (trace) =>
      trace.episodeId === episodeId &&
      trace.runId === runId &&
      trace.outcome !== undefined
  );
  // totalAttempts = one per real turn-selection attempt ("proposed" outcome).
  // failedCount/repairedCount both represent rework needed on top of that attempt.
  const totalAttempts = relevant.filter((trace) => trace.outcome === "proposed").length;
  const failedCount = relevant.filter((trace) => trace.outcome === "failed").length;
  const repairedCount = relevant.filter((trace) => trace.outcome === "repaired").length;
  const score =
    totalAttempts === 0 ? 1 : Math.max(0, 1 - (failedCount + repairedCount) / totalAttempts);
  const reason = `${totalAttempts} attempts, ${repairedCount} repaired, ${failedCount} failed`;
  return { score, reason, counts: { totalAttempts, failedCount, repairedCount } };
}

export async function readTraceLines(tracePath: string): Promise<TweedyTrace[]> {
  let content: string;
  try {
    content = await fs.readFile(tracePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as TweedyTrace);
}

export function createRejectionRepairRateScorer(tracePath: string) {
  return createScorer<ExperimentRunInput, ExperimentRunOutput>({
    id: "rejection-repair-rate",
    description:
      "Measures how often turn candidates were rejected or repaired before acceptance",
  })
    .generateScore(async ({ run }) => {
      const traces = await readTraceLines(tracePath);
      return computeRejectionRepairRate(traces, run.output.episodeId, run.output.runId).score;
    })
    .generateReason(async ({ run }) => {
      const traces = await readTraceLines(tracePath);
      return computeRejectionRepairRate(traces, run.output.episodeId, run.output.runId).reason;
    });
}
