import { Mastra } from "@mastra/core/mastra";
import { LibSQLStore } from "@mastra/libsql";
import { Observability, MastraStorageExporter } from "@mastra/observability";
import { AiProviderName } from "../types";
import { createMinimalWorkflow } from "./minimal-workflow";
import { createModelTaskRoutes } from "./model-routes";
import { JsonlTraceSink, TraceSink } from "./tracing";
import {
  createEpisodeWorkflow,
  EpisodeWorkflowDependencies,
} from "./episode-workflow";
import {
  createExperimentWorkflow,
  ExperimentWorkflowDependencies,
} from "./experiment/experiment-workflow";
import { createTranscriptQualityScorer } from "./experiment/transcript-quality-scorer";
import { createRejectionRepairRateScorer } from "./experiment/rejection-repair-rate-scorer";
import { directorMastraAgent } from "./agents/director-agent";
import { speakerMastraAgent } from "./agents/speaker-agent";

export interface CreateTweedyMastraOptions {
  storagePath: string;
  tracePath?: string;
  traceSink?: TraceSink;
  provider?: AiProviderName;
  episodeWorkflowDependencies?: EpisodeWorkflowDependencies;
  experimentWorkflowDependencies?: ExperimentWorkflowDependencies;
}

/**
 * Side-effect-free composition root. Importing this module does not construct
 * provider clients, open a database, start a server or execute a workflow.
 */
export function createTweedyMastra(options: CreateTweedyMastraOptions) {
  const storage = new LibSQLStore({
    id: "tweedy-mastra-storage",
    url: toFileUrl(options.storagePath),
  });
  const tracePath = options.tracePath ?? `${options.storagePath}.traces.jsonl`;
  const traceSink = options.traceSink ?? new JsonlTraceSink(tracePath);
  const minimalWorkflow = createMinimalWorkflow(traceSink);
  const episodeWorkflow = options.episodeWorkflowDependencies
    ? createEpisodeWorkflow(options.episodeWorkflowDependencies, traceSink)
    : undefined;
  const experimentWorkflow = options.experimentWorkflowDependencies
    ? createExperimentWorkflow(options.experimentWorkflowDependencies)
    : undefined;
  const routes = createModelTaskRoutes(
    options.provider ?? AiProviderName.Anthropic
  );
  const mastra = new Mastra({
    storage,
    agents: {
      directorAgent: directorMastraAgent,
      speakerAgent: speakerMastraAgent,
    },
    workflows: episodeWorkflow
      ? experimentWorkflow
        ? { minimalWorkflow, episodeWorkflow, episodeExperimentRun: experimentWorkflow }
        : { minimalWorkflow, episodeWorkflow }
      : experimentWorkflow
        ? { minimalWorkflow, episodeExperimentRun: experimentWorkflow }
        : { minimalWorkflow },
    scorers: {
      "transcript-quality": createTranscriptQualityScorer(),
      "rejection-repair-rate": createRejectionRepairRateScorer(tracePath),
    },
    observability: new Observability({
      configs: {
        default: {
          serviceName: "tweedy",
          exporters: [new MastraStorageExporter()],
        },
      },
    }),
  });

  return { mastra, storage, traceSink, routes, episodeWorkflow, experimentWorkflow };
}

function toFileUrl(storagePath: string): string {
  return storagePath === ":memory:" || storagePath.startsWith("file:")
    ? storagePath
    : `file:${storagePath}`;
}

export * from "./minimal-workflow";
export * from "./episode-workflow";
export * from "./experiment/experiment-workflow";
export * from "./experiment/transcript-quality-scorer";
export * from "./experiment/rejection-repair-rate-scorer";
export * from "./model-routes";
export * from "./runtime-context";
export * from "./tracing";
export * from "./agents/director-agent";
export * from "./agents/speaker-agent";
