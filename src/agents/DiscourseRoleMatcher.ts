import { DiscourseRole, EmbeddingService } from "../types";
import { logger } from "../utils/logger";

const ROLE_DESCRIPTIONS: ReadonlyArray<{
  role: DiscourseRole;
  description: string;
}> = [
  { role: "context", description: "context, setup, background, or definition" },
  { role: "proposition", description: "main proposition, thesis, or assertion" },
  { role: "action", description: "action, event, or something that happens" },
  { role: "mechanism", description: "mechanism, cause, process, or how something works" },
  { role: "explanation", description: "explanation, interpretation, or clarification" },
  { role: "evidence", description: "evidence, observation, data, or supporting fact" },
  { role: "example", description: "example, illustration, instance, or case" },
  { role: "surprise", description: "surprise, reveal, twist, or unexpected fact" },
  { role: "complication", description: "complication, obstacle, conflict, or problem" },
  { role: "implication", description: "implication, consequence, effect, or reaction" },
  { role: "payoff", description: "payoff, outcome, resolution, or conclusion" },
];

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? -Infinity : dot / denominator;
}

export class DiscourseRoleMatcher {
  private roleEmbeddings?: Promise<number[][]>;

  constructor(private readonly embeddingService: EmbeddingService) {}

  async match(label: string): Promise<DiscourseRole> {
    const normalised = label.trim().toLowerCase();
    const exact = ROLE_DESCRIPTIONS.find(({ role }) => role === normalised);
    if (exact) return exact.role;

    try {
      const [labelEmbedding, roleEmbeddings] = await Promise.all([
        this.embeddingService.embedText(normalised),
        this.getRoleEmbeddings(),
      ]);
      let bestIndex = 0;
      let bestScore = -Infinity;
      for (let index = 0; index < roleEmbeddings.length; index += 1) {
        const score = cosineSimilarity(labelEmbedding, roleEmbeddings[index]);
        if (score > bestScore) {
          bestIndex = index;
          bestScore = score;
        }
      }
      const role = ROLE_DESCRIPTIONS[bestIndex].role;
      logger.warn(
        `Director discourse role ${JSON.stringify(label)} mapped to ${JSON.stringify(
          role
        )} by semantic similarity (${bestScore.toFixed(3)})`
      );
      return role;
    } catch (error) {
      logger.warn(
        `Director could not embed discourse role ${JSON.stringify(
          label
        )}; falling back to "proposition"`,
        error
      );
      return "proposition";
    }
  }

  private async getRoleEmbeddings(): Promise<number[][]> {
    if (!this.roleEmbeddings) {
      this.roleEmbeddings = this.embeddingService.embedDocuments(
        ROLE_DESCRIPTIONS.map(({ description }) => description)
      );
    }
    return this.roleEmbeddings;
  }
}
