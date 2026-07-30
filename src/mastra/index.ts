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
import { directorMastraAgent } from "./agents/director-agent";
import { speakerMastraAgent } from "./agents/speaker-agent";

export interface CreateTweedyMastraOptions {
  storagePath: string;
  tracePath?: string;
  traceSink?: TraceSink;
  provider?: AiProviderName;
  episodeWorkflowDependencies?: EpisodeWorkflowDependencies;
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
  const traceSink =
    options.traceSink ??
    new JsonlTraceSink(
      options.tracePath ?? `${options.storagePath}.traces.jsonl`
    );
  const minimalWorkflow = createMinimalWorkflow(traceSink);
  const episodeWorkflow = options.episodeWorkflowDependencies
    ? createEpisodeWorkflow(options.episodeWorkflowDependencies, traceSink)
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
      ? { minimalWorkflow, episodeWorkflow }
      : { minimalWorkflow },
    observability: new Observability({
      configs: {
        default: {
          serviceName: "tweedy",
          exporters: [new MastraStorageExporter()],
        },
      },
    }),
  });

  return { mastra, storage, traceSink, routes, episodeWorkflow };
}

function toFileUrl(storagePath: string): string {
  return storagePath === ":memory:" || storagePath.startsWith("file:")
    ? storagePath
    : `file:${storagePath}`;
}

export * from "./minimal-workflow";
export * from "./episode-workflow";
export * from "./model-routes";
export * from "./runtime-context";
export * from "./tracing";
export * from "./agents/director-agent";
export * from "./agents/speaker-agent";
