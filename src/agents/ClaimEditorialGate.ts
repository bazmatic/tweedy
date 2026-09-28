import { DiscourseClaim, PodcastScript, Speech } from "../types";
import { SpeakerAgentToolName } from "./speaker-tools";
import { gateClaims } from "./TypeSafeClaimGateJudge";

// A turn shorter than this carries no gateable claim (e.g. "Oh, wow.").
const MIN_CLAIM_WORDS = 5;
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

/**
 * Gates a candidate turn against planned claim dependencies and repetition,
 * via the `claim-gate` judgment.
 */
export class ClaimEditorialGate {
  async evaluate(candidate: Speech, script: PodcastScript): Promise<ClaimGateResult> {
    // A closing is supposed to synthesise established material. Its separate
    // conclusion policy checks that it does not introduce an unresolved topic.
    if (candidate.tool === SpeakerAgentToolName.CLOSING_STATEMENT) {
      return { accepted: true };
    }
    if (candidate.message.trim().split(/\s+/).length < MIN_CLAIM_WORDS) {
      return { accepted: true };
    }
    const claims = this.allClaims(script);
    return gateClaims({
      candidateTurn: candidate.message,
      saidSoFar: script.speeches.map(
        (speech) => `${speech.speaker.name}: ${speech.message}`
      ),
      blockedClaims: this.blockedClaims(claims),
      contributionTargets: this.contributionTargets(candidate, claims),
    });
  }

  /** Planned claims whose listener prerequisites are not yet established. */
  private blockedClaims(claims: DiscourseClaim[]): DiscourseClaim[] {
    return claims.filter(
      (claim) =>
        claim.state !== "established" &&
        claim.state !== "developed" &&
        claim.prerequisiteClaimIds.some(
          (id) => !this.isEstablished(id, claims)
        )
    );
  }

  /** Ready, contributive claims the candidate's brief targets. */
  private contributionTargets(
    candidate: Speech,
    claims: DiscourseClaim[]
  ): DiscourseClaim[] {
    return claims.filter(
      (claim) =>
        candidate.turnBrief?.targetDiscourseClaimIds?.includes(claim.id) &&
        claim.state !== "established" &&
        claim.state !== "developed" &&
        CONTRIBUTIVE_ROLES.has(claim.role) &&
        claim.prerequisiteClaimIds.every((id) => this.isEstablished(id, claims))
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
}
