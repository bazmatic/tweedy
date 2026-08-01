import { describe, expect, it } from "vitest";
import { computeRejectionRepairRate, readTraceLines } from "./rejection-repair-rate-scorer";
import { TweedyTrace } from "../tracing";
import { ModelTask } from "../../providers/ModelRoutingPolicy";
import { mkdtemp, rm, writeFile } from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach } from "vitest";

function trace(overrides: Partial<TweedyTrace> = {}): TweedyTrace {
  return {
    episodeId: "ep-1",
    runId: "run-1",
    flowVersion: "mastra-episode-v1",
    modelTask: ModelTask.DirectionSelection,
    retryCount: 0,
    latencyMs: 0,
    ...overrides,
  };
}

describe("computeRejectionRepairRate", () => {
  it("scores 1 with no attempts", () => {
    const result = computeRejectionRepairRate([], "ep-1", "run-1");
    expect(result.score).toBe(1);
    expect(result.counts).toEqual({ totalAttempts: 0, failedCount: 0, repairedCount: 0 });
  });

  it("counts only failed/repaired outcomes for the matching episode+run", () => {
    const traces = [
      trace({ outcome: "proposed" }),
      trace({ outcome: "repaired" }),
      trace({ outcome: "failed" }),
      trace({ outcome: "completed" }),
      trace({ outcome: "failed", episodeId: "other-episode" }),
      trace({ outcome: "failed", runId: "other-run" }),
    ];
    const result = computeRejectionRepairRate(traces, "ep-1", "run-1");
    expect(result.counts).toEqual({ totalAttempts: 4, failedCount: 1, repairedCount: 1 });
    expect(result.score).toBe(0.75);
    expect(result.reason).toBe("4 attempts, 1 repaired, 1 failed");
  });
});

describe("readTraceLines", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })));
  });

  it("returns an empty array when the trace file does not exist", async () => {
    const result = await readTraceLines("/nonexistent/path/traces.jsonl");
    expect(result).toEqual([]);
  });

  it("parses newline-delimited trace records, skipping blank lines", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tweedy-trace-lines-"));
    tempDirs.push(dir);
    const tracePath = path.join(dir, "traces.jsonl");
    const one = trace({ outcome: "failed" });
    const two = trace({ outcome: "completed" });
    await writeFile(tracePath, `${JSON.stringify(one)}\n\n${JSON.stringify(two)}\n`, "utf8");

    const result = await readTraceLines(tracePath);
    expect(result).toEqual([one, two]);
  });
});
