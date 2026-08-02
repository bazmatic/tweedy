import { readdir, stat } from "fs/promises";
import * as path from "path";
import type { Dataset } from "@mastra/core/datasets";

export async function resolveScriptId(
  scriptsDir: string,
  explicitId?: string
): Promise<string> {
  if (explicitId) return explicitId;
  const entries = await readdir(scriptsDir);
  const files = entries.filter((file) => file.endsWith(".json"));
  if (files.length === 0) {
    throw new Error(`No scripts found in ${scriptsDir}`);
  }
  const withMtime = await Promise.all(
    files.map(async (file) => ({
      id: path.basename(file, ".json"),
      mtimeMs: (await stat(path.join(scriptsDir, file))).mtimeMs,
    }))
  );
  withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return withMtime[0].id;
}

const DEFAULT_RUN_PARAMETER_SETS: { maxTurns: number; maxDurationSeconds: number }[] = [
  { maxTurns: 8, maxDurationSeconds: 240 },
  { maxTurns: 16, maxDurationSeconds: 480 },
  { maxTurns: 24, maxDurationSeconds: 720 },
];

const REPEATS_PER_PARAMETER_SET = 2;

export async function seedExperimentDataset(dataset: Dataset, scriptId: string) {
  const items = DEFAULT_RUN_PARAMETER_SETS.flatMap((parameters) =>
    Array.from({ length: REPEATS_PER_PARAMETER_SET }, () => ({
      input: {
        scriptId,
        maxTurns: parameters.maxTurns,
        maxDurationSeconds: parameters.maxDurationSeconds,
      },
    }))
  );
  return dataset.addItems({ items });
}
