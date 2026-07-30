import {
  DiscourseClaim,
  EmbeddingService,
  PodcastScript,
  Speech,
} from "../types";
import { LocalEmbeddingService } from "../rag/LocalEmbeddingService";
import { logger } from "../utils/logger";
import { SpeakerAgentToolName } from "./speaker-tools";

const NOVELTY_SIMILARITY = 0.82;
const CLAIM_MATCH_SIMILARITY = 0.7;
const REPEATED_PROPORTION = 0.6;
const CONTRIBUTIVE_ROLES = new Set([
  "explanation",
  "implication",
  "payoff",
  "surprise",
]);

export interface ClaimGateResult {
  accepted: boolean;
  reason?: string;
}

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

/**
 * A deterministic acceptance policy over semantic vectors. The embedding
 * model supplies similarity only; fixed rules decide whether a candidate is
 * repetitive or jumps ahead of its listener prerequisites.
 */
export class ClaimEditorialGate {
  private readonly embeddingCache = new Map<string, Promise<number[]>>();

  constructor(
    private readonly embeddings: EmbeddingService = new LocalEmbeddingService()
  ) {}

  async evaluate(candidate: Speech, script: PodcastScript): Promise<ClaimGateResult> {
    // A closing is supposed to synthesise established material. Its separate
    // conclusion policy checks that it does not introduce an unresolved topic.
    if (candidate.tool === SpeakerAgentToolName.CLOSING_STATEMENT) {
      return { accepted: true };
    }
    const candidateClaims = this.propositions(candidate.message);
    if (candidateClaims.length === 0) return { accepted: true };

    try {
      const plannedClaims = this.allClaims(script);
      const candidateVectors = await this.embedMany(candidateClaims);

      const dependencyFailure = await this.findDependencyFailure(
        candidateVectors,
        plannedClaims
      );
      if (dependencyFailure) {
        return {
          accepted: false,
          reason: `Claim ${dependencyFailure.id} appears before its listener prerequisites`,
        };
      }

      const priorClaims = script.speeches.flatMap((speech) =>
        this.propositions(speech.message)
      );
      if (priorClaims.length === 0) return { accepted: true };
      const priorVectors = await this.embedMany(priorClaims);
      const repeated = candidateVectors.filter((vector) =>
        priorVectors.some(
          (prior) => cosineSimilarity(vector, prior) >= NOVELTY_SIMILARITY
        )
      ).length;
      if (repeated / candidateClaims.length < REPEATED_PROPORTION) {
        return { accepted: true };
      }

      if (
        await this.addsPlannedContribution(
          candidate,
          candidateVectors,
          plannedClaims
        )
      ) {
        return { accepted: true };
      }
      return {
        accepted: false,
        reason: "Candidate substantially repeats claims listeners already heard",
      };
    } catch (error) {
      logger.warn("Claim editorial gate unavailable; accepting candidate", error);
      return { accepted: true };
    }
  }

  private async findDependencyFailure(
    candidateVectors: number[][],
    claims: DiscourseClaim[]
  ): Promise<DiscourseClaim | undefined> {
    const blocked = claims.filter(
      (claim) =>
        claim.state !== "established" &&
        claim.state !== "developed" &&
        claim.prerequisiteClaimIds.some(
          (id) => !this.isEstablished(id, claims)
        )
    );
    if (blocked.length === 0) return undefined;
    const blockedVectors = await this.embedMany(
      blocked.map((claim) => claim.text)
    );
    for (let claimIndex = 0; claimIndex < blocked.length; claimIndex += 1) {
      if (
        candidateVectors.some(
          (vector) =>
            cosineSimilarity(vector, blockedVectors[claimIndex]) >=
            CLAIM_MATCH_SIMILARITY
        )
      ) {
        return blocked[claimIndex];
      }
    }
    return undefined;
  }

  private async addsPlannedContribution(
    candidate: Speech,
    candidateVectors: number[][],
    claims: DiscourseClaim[]
  ): Promise<boolean> {
    const targets = claims.filter(
      (claim) =>
        candidate.turnBrief?.targetDiscourseClaimIds?.includes(claim.id) &&
        claim.state !== "established" &&
        claim.state !== "developed" &&
        CONTRIBUTIVE_ROLES.has(claim.role) &&
        claim.prerequisiteClaimIds.every((id) => this.isEstablished(id, claims))
    );
    if (targets.length === 0) return false;
    const targetVectors = await this.embedMany(
      targets.map((claim) => claim.text)
    );
    return candidateVectors.some((vector) =>
      targetVectors.some(
        (target) =>
          cosineSimilarity(vector, target) >= CLAIM_MATCH_SIMILARITY
      )
    );
  }

  private allClaims(script: PodcastScript): DiscourseClaim[] {
    return (script.conversationBeats ?? []).flatMap(
      (beat) => beat.discourseClaims ?? []
    );
  }

  private isEstablished(id: string, claims: DiscourseClaim[]): boolean {
    return claims.some(
      (claim) =>
        claim.id === id &&
        (claim.state === "established" || claim.state === "developed")
    );
  }

  private propositions(message: string): string[] {
    return message
      .split(/(?<=[.!?])\s+|\n+/)
      .map((part) =>
        part
          .replace(/^(?:exactly|right|yes|yeah|oh|well|okay|so)[,!—:\s-]*/i, "")
          .trim()
      )
      .filter((part) => part.split(/\s+/).length >= 5);
  }

  private embedMany(texts: string[]): Promise<number[][]> {
    return Promise.all(
      texts.map((text) => {
        const key = text.normalize("NFKC").toLocaleLowerCase().trim();
        let embedding = this.embeddingCache.get(key);
        if (!embedding) {
          embedding = this.embeddings.embedText(text);
          this.embeddingCache.set(key, embedding);
        }
        return embedding;
      })
    );
  }
}
