import type { Mastra } from "@mastra/core/mastra";
import type { Dataset } from "@mastra/core/datasets";
import { ExperimentRunInputSchema } from "./experiment-workflow";

export const EXPERIMENT_DATASET_NAME = "podcast-episode-experiments";

export async function ensureExperimentDataset(mastra: Mastra): Promise<Dataset> {
  const { datasets } = await mastra.datasets.list();
  const existing = datasets.find((dataset) => dataset.name === EXPERIMENT_DATASET_NAME);
  if (existing) {
    return mastra.datasets.get({ id: existing.id });
  }
  return mastra.datasets.create({
    name: EXPERIMENT_DATASET_NAME,
    description:
      "Podcast episode generation runs, swept across run parameters, guidance, provider and prompt variants.",
    inputSchema: ExperimentRunInputSchema,
    targetType: "workflow",
    targetIds: ["episodeExperimentRun"],
    scorerIds: ["transcript-quality", "rejection-repair-rate"],
  });
}
