import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AiProviderName } from "../types";
import { AiModelFactory } from "../providers/AiModelFactory";
import {
  ModelRoutingPolicy,
  ModelTask,
  ModelTier,
} from "../providers/ModelRoutingPolicy";
import { ProviderModelCatalogue } from "../providers/ProviderModelCatalogue";

export interface MastraCompatibilityRoute {
  task: ModelTask;
  path: "langchain-compatibility";
  provider: AiProviderName;
  model: string;
  tier: ModelTier;
  temperature?: number;
  createModel(maxTokens: number): BaseChatModel;
}

/**
 * Incremental bridge for Mastra workflow steps. It preserves Tweedy's current
 * provider catalogue, task tier, token budget and LangChain structured-output
 * implementation until each task is intentionally migrated to a Mastra Agent.
 */
export function createModelTaskRoutes(
  provider: AiProviderName
): Record<ModelTask, MastraCompatibilityRoute> {
  const policy = new ModelRoutingPolicy();
  const catalogue = new ProviderModelCatalogue();

  return Object.fromEntries(
    Object.values(ModelTask).map((task) => {
      const tier = policy.resolve(task);
      return [
        task,
        {
          task,
          path: "langchain-compatibility" as const,
          provider,
          model: catalogue.resolve(provider, tier),
          tier,
          temperature: policy.resolveTemperature(task),
          createModel: (maxTokens: number) =>
            AiModelFactory.getModel(provider, task, maxTokens),
        },
      ];
    })
  ) as Record<ModelTask, MastraCompatibilityRoute>;
}
