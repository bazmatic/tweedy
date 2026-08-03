import type { Mastra } from "@mastra/core/mastra";
import type { Dataset } from "@mastra/core/datasets";
import { ExperimentRunInputSchema } from "./experiment-workflow";

export const EXPERIMENT_DATASET_NAME = "podcast-episode-experiments";

export async function ensureExperimentDataset(mastra: Mastra): Promise<Dataset> {
  // `id` is a stable, caller-defined identity: the storage layer atomically
  // creates the dataset or returns the existing one that already owns this
  // id, so this is race-free even under concurrent calls (unlike a
  // list-then-create pattern, which is also capped by list()'s default
  // pagination page size).
  return mastra.datasets.create({
    id: EXPERIMENT_DATASET_NAME,
    name: EXPERIMENT_DATASET_NAME,
    description:
      "Podcast episode generation runs, swept across run parameters, guidance, provider and prompt variants.",
    inputSchema: ExperimentRunInputSchema,
    targetType: "workflow",
    targetIds: ["episodeExperimentRun"],
    scorerIds: ["transcript-quality", "rejection-repair-rate"],
  });
}
