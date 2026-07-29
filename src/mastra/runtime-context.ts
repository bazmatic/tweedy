import { AiProviderName } from "../types";
import { ModelTask } from "../providers/ModelRoutingPolicy";

export interface RuntimeRepositories {
  materials?: unknown;
  speakers?: unknown;
  speeches?: unknown;
  voices?: unknown;
}

/**
 * Credentials are deliberately separate from workflow input/state. Steps may
 * use them to construct provider clients, but must never return or trace them.
 */
export interface ProviderCredentials {
  openAiApiKey?: string;
  anthropicApiKey?: string;
  deepSeekApiKey?: string;
  xAiApiKey?: string;
}

export interface TweedyRuntimeContext {
  episodeId: string;
  runId: string;
  flowVersion: string;
  provider: AiProviderName;
  modelTask: ModelTask;
  repositories: RuntimeRepositories;
  credentials: ProviderCredentials;
}
