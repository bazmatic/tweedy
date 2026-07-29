import { DiscussionPoint } from "../types";
import {
  VerifyCoveredPointsInput,
  verifyCoveredPointsSchema,
} from "./director-schemas";
import { ModelTask } from "../providers/ModelRoutingPolicy";
import { logger } from "../utils/logger";

export type StructuredModelCaller<T> = (
  task: ModelTask,
  messages: { role: "user"; content: string }[],
  schema: unknown,
  maxTokens: number
) => Promise<T>;

/**
 * The director's coveredPointIds claim can hallucinate coverage from a
 * merely topically-adjacent mention (e.g. an oxygen tank explosion
 * "covering" a CO2 scrubber duct-tape hack point). Re-checks each claim in a
 * dedicated structured verification call against the actual conversation
 * history. Never mutates candidatePoints — the caller decides how to apply
 * confirmed ids.
 */
export async function verifyCoveredPointClaims(
  callModel: StructuredModelCaller<VerifyCoveredPointsInput>,
  recentHistory: string,
  candidatePoints: DiscussionPoint[]
): Promise<string[]> {
  if (candidatePoints.length === 0) {
    return [];
  }

  const pointsList = candidatePoints
    .map((point) => `- ${point.id}: ${point.text}`)
    .join("\n");

  const messages = [
    {
      role: "user" as const,
      content: `The director claimed the following discussion points were covered somewhere in the conversation below. Verify each one strictly against the actual text — a point only counts as covered if it was explicitly and substantively discussed with specific detail from the point's text, not merely a topically-adjacent mention. For example, if a point is "CO2 scrubber duct-tape hack" and the speech only mentions an oxygen tank explosion, that point is NOT covered.

Full conversation so far:
${recentHistory || "(nothing said yet)"}

Candidate points claimed as covered:
${pointsList}

Return only the ids of points that were genuinely, substantively covered.`,
    },
  ];

  try {
    const { confirmedPointIds } = await callModel(
      ModelTask.CoverageVerification,
      messages,
      verifyCoveredPointsSchema,
      150
    );
    return confirmedPointIds;
  } catch (error) {
    logger.error(
      "Failed to verify covered points; treating claims as unconfirmed:",
      error
    );
    return [];
  }
}
