import { EditorialCard } from "../types";
import { BaseAgent } from "./BaseAgent";
import { ModelTask } from "../providers/ModelRoutingPolicy";
import { cardRelationSchema, CardRelationExtractionInput } from "./editorial-schemas";

const DEFAULT_MAX_EXTRACTION_TOKENS = 1500;

export class CardRelationExtractorAgent extends BaseAgent {
  /**
   * @param maxTokens output budget for the structured response. Callers should
   * size this from the number of candidate groups (roughly 35-45 tokens per
   * emitted edge); too small a budget truncates the JSON and loses every edge.
   */
  async extractRelations(
    candidateGroups: EditorialCard[][],
    maxTokens: number = DEFAULT_MAX_EXTRACTION_TOKENS
  ): Promise<CardRelationExtractionInput["edges"]> {
    if (candidateGroups.length === 0) return [];

    const groupsText = candidateGroups
      .map((group, index) => {
        const cardsText = group
          .map(
            (card) =>
              `  - ${card.id} [${card.kind}]: ${card.content}\n    Significance: ${card.significance}`
          )
          .join("\n");
        return `Group ${index + 1}:\n${cardsText}`;
      })
      .join("\n\n");

    const messages = [
      {
        role: "user" as const,
        content: `You are linking editorial cards prepared for a single podcast episode. Each group below is a set of cards an embedding search flagged as potentially related. For each group, decide whether the cards genuinely connect (shared concept, contrast, cause/effect, or narrative link) and, if so, classify the relationship and give a one-sentence rationale. Omit a group entirely if its cards do not meaningfully connect — do not force a relation.

${groupsText}

Return one edge per group that is genuinely related. Use the exact card ids given above in cardIds.`,
      },
    ];

    const { edges } = await this.callModelForStructuredOutput<CardRelationExtractionInput>(
      ModelTask.CardRelationExtraction,
      messages,
      cardRelationSchema,
      maxTokens
    );
    return edges;
  }
}
