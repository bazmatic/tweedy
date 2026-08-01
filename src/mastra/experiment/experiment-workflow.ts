import { randomUUID } from "crypto";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { PodcastScript, SpeakerAllocation } from "../../types";
import { MastraEpisodeRunner } from "../../services/conversation-engine";

export const ExperimentRunInputSchema = z.object({
  scriptId: z.string().min(1),
  maxTurns: z.number().int().positive(),
  maxDurationSeconds: z.number().positive(),
});
export type ExperimentRunInput = z.infer<typeof ExperimentRunInputSchema>;

export const ExperimentRunOutputSchema = z.object({
  episodeId: z.string(),
  runId: z.string(),
  transcript: z.array(
    z.object({ speakerId: z.string(), message: z.string() })
  ),
});
export type ExperimentRunOutput = z.infer<typeof ExperimentRunOutputSchema>;

export interface ExperimentWorkflowDependencies {
  runner: MastraEpisodeRunner;
  loadScript(scriptId: string): Promise<PodcastScript>;
}

export function createExperimentWorkflow(deps: ExperimentWorkflowDependencies) {
  const runEpisode = createStep({
    id: "run-episode",
    inputSchema: ExperimentRunInputSchema,
    outputSchema: ExperimentRunOutputSchema,
    execute: async ({ inputData }) => {
      const script = await deps.loadScript(inputData.scriptId);
      const workflowRunId = randomUUID();
      const resultScript = await deps.runner.run({
        script,
        params: {
          title: script.title,
          description: script.description,
          guidance: script.guidance,
          speakers: script.speakers,
          materials: script.materials,
          maxTurns: inputData.maxTurns,
          maxDuration: inputData.maxDurationSeconds,
          allocation: SpeakerAllocation.Managed,
          audienceProfile: script.audienceProfile,
        },
        workflowRunId,
      });
      return {
        episodeId: script.id,
        runId: workflowRunId,
        transcript: resultScript.speeches.map((speech) => ({
          speakerId: speech.speaker.id,
          message: speech.message,
        })),
      };
    },
  });

  return createWorkflow({
    id: "episode-experiment-run",
    inputSchema: ExperimentRunInputSchema,
    outputSchema: ExperimentRunOutputSchema,
  })
    .then(runEpisode)
    .commit();
}
