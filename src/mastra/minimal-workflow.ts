import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { ModelTask } from "../providers/ModelRoutingPolicy";
import { TraceSink } from "./tracing";

export const MinimalWorkflowInputSchema = z.object({
  episodeId: z.string().min(1),
  runId: z.string().min(1),
  flowVersion: z.string().min(1),
  modelTask: z.nativeEnum(ModelTask),
  logicalTurn: z.number().int().nonnegative().optional(),
});

export const MinimalWorkflowOutputSchema = MinimalWorkflowInputSchema.extend({
  completed: z.literal(true),
});

export function createMinimalWorkflow(traceSink: TraceSink) {
  const complete = createStep({
    id: "complete",
    inputSchema: MinimalWorkflowInputSchema,
    outputSchema: MinimalWorkflowOutputSchema,
    execute: async ({ inputData }) => {
      const startedAt = Date.now();
      const output = { ...inputData, completed: true as const };
      await traceSink.export({
        episodeId: inputData.episodeId,
        runId: inputData.runId,
        flowVersion: inputData.flowVersion,
        modelTask: inputData.modelTask,
        logicalTurn: inputData.logicalTurn,
        retryCount: 0,
        latencyMs: Date.now() - startedAt,
        outcome: "completed",
      });
      return output;
    },
  });

  return createWorkflow({
    id: "tweedy-runtime-smoke",
    inputSchema: MinimalWorkflowInputSchema,
    outputSchema: MinimalWorkflowOutputSchema,
    options: { shouldPersistSnapshot: () => true },
  })
    .then(complete)
    .commit();
}
