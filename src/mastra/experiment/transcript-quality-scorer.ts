import { createScorer } from "@mastra/core/evals";
import { z } from "zod";
import type { ExperimentRunInput, ExperimentRunOutput } from "./experiment-workflow";

const QUALITY_JUDGE_MODEL = "anthropic/claude-sonnet-4-5";

export function buildTranscript(
  transcript: ExperimentRunOutput["transcript"]
): string {
  return transcript.map((turn) => `${turn.speakerId}: ${turn.message}`).join("\n");
}

export function buildQualityPrompt(transcript: string): string {
  return `Rate this podcast transcript from 1 (worst) to 5 (best) on each dimension below. Give a one-sentence reason for each rating. Do not default to the middle of the scale — be exacting.

- engaging: varied pacing and tone, holds listener attention, avoids repetitive phrasing
- informative: conveys real content and specifics, not vague filler
- coherent: turns build on what was said before, no contradictions or dropped threads
- understandable: a general audience could follow it without prior expertise

Transcript:
${transcript || "(empty — no turns were accepted)"}`;
}

const QualityRatingSchema = z.object({
  score: z.number().int().min(1).max(5),
  reason: z.string(),
});

export const QualityAnalysisSchema = z.object({
  engaging: QualityRatingSchema,
  informative: QualityRatingSchema,
  coherent: QualityRatingSchema,
  understandable: QualityRatingSchema,
});
export type QualityAnalysis = z.infer<typeof QualityAnalysisSchema>;

export function averageQualityScore(analysis: QualityAnalysis): number {
  const scores = [
    analysis.engaging.score,
    analysis.informative.score,
    analysis.coherent.score,
    analysis.understandable.score,
  ];
  const average = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  return average / 5;
}

export function formatQualityReason(analysis: QualityAnalysis): string {
  const dimensions: (keyof QualityAnalysis)[] = [
    "engaging",
    "informative",
    "coherent",
    "understandable",
  ];
  return dimensions
    .map((dimension) => `${dimension}=${analysis[dimension].score} (${analysis[dimension].reason})`)
    .join("; ");
}

export function createTranscriptQualityScorer() {
  return createScorer<ExperimentRunInput, ExperimentRunOutput>({
    id: "transcript-quality",
    description:
      "Judges the generated transcript on engagement, informativeness, coherence, and understandability",
    judge: {
      model: QUALITY_JUDGE_MODEL,
      instructions:
        "You are an exacting podcast script editor evaluating a generated transcript.",
    },
  })
    .preprocess(({ run }) => buildTranscript(run.output.transcript))
    .analyze({
      description: "Rate the transcript on four quality dimensions",
      outputSchema: QualityAnalysisSchema,
      createPrompt: ({ results }) =>
        buildQualityPrompt(results.preprocessStepResult as string),
    })
    .generateScore(({ results }) => {
      const transcript = results.preprocessStepResult as string;
      if (!transcript) return 0;
      return averageQualityScore(results.analyzeStepResult as QualityAnalysis);
    })
    .generateReason(({ results }) => {
      const transcript = results.preprocessStepResult as string;
      if (!transcript) return "no accepted turns to judge";
      return formatQualityReason(results.analyzeStepResult as QualityAnalysis);
    });
}
