import { IJudgmentProvider, noul, NoulQuestion } from "../providers/judgment-questions";
import { decide, JudgmentDecision } from "../services/decide";
import { getJudgmentProvider } from "../services/judgment-runtime";

export const CLAIM_GATE_JUDGMENT = "claim-gate";

/**
 * Per-check thresholds. The first all-on run rejected 17 of 28 candidate
 * turns at a flat 0.5, mostly for "states a claim before its prerequisites"
 * at 0.5-0.75 — including the episode's core pitch — and once for a
 * four-word reaction judged 0.52 repetitive. Rejecting a turn discards it,
 * so the reject conditions need clear evidence; the establish-a-target
 * exception, which only rescues a turn, stays at an even split.
 */
export interface ClaimGateThresholds {
  /** Reject when a blocked claim is stated with at least this probability. */
  prerequisite: number;
  /** Reject as repetitive at or above this probability. */
  repetition: number;
  /** A repetitive turn is kept if it establishes a target at or above this. */
  establishesTarget: number;
}

export const DEFAULT_CLAIM_GATE_THRESHOLDS: ClaimGateThresholds = {
  prerequisite: 0.8,
  repetition: 0.7,
  establishesTarget: 0.5,
};

export interface ClaimGateVerdict {
  accepted: boolean;
  reason?: string;
}

export interface ClaimRef {
  id: string;
  text: string;
}

export interface ClaimGateRequest {
  candidateTurn: string;
  /** Every earlier line, by any speaker, as "Name: message". */
  saidSoFar: string[];
  /** Planned claims whose listener prerequisites are not yet established. */
  blockedClaims: ClaimRef[];
  /** Ready, contributive claims this turn was briefed to establish. */
  contributionTargets: ClaimRef[];
}

export interface ClaimGateJudgeDeps {
  provider?: IJudgmentProvider;
  thresholds?: Partial<ClaimGateThresholds>;
}

/**
 * Gates a candidate turn through the `claim-gate` judgment: reject a claim
 * stated before its prerequisites, then reject substantial repetition unless
 * the turn establishes a planned target claim.
 */
export function gateClaims(
  request: ClaimGateRequest,
  deps: ClaimGateJudgeDeps = {}
): Promise<ClaimGateVerdict> {
  return decide({
    judgment: CLAIM_GATE_JUDGMENT,
    ask: () =>
      gateClaimsWithTypeSafe(
        request,
        deps.provider ?? getJudgmentProvider(),
        { ...DEFAULT_CLAIM_GATE_THRESHOLDS, ...deps.thresholds }
      ),
    fallback: { accepted: true },
    state: {
      candidateTurn: request.candidateTurn,
      blockedClaimIds: request.blockedClaims.map((claim) => claim.id),
      contributionTargetIds: request.contributionTargets.map((claim) => claim.id),
    },
  });
}

export async function gateClaimsWithTypeSafe(
  request: ClaimGateRequest,
  provider: IJudgmentProvider,
  thresholds: ClaimGateThresholds = DEFAULT_CLAIM_GATE_THRESHOLDS
): Promise<JudgmentDecision<ClaimGateVerdict>> {
  const questions: Record<string, NoulQuestion> = {};
  if (request.saidSoFar.length > 0) {
    questions.repeats_what_listeners_already_heard = noul(
      "Taken as a whole, does `candidate_turn` mostly repeat facts or claims already stated in `said_so_far` " +
        "(by any speaker), even if reworded, rather than adding something new?",
      {
        true: "Most of what it says was already said",
        false: "It adds new information, a new angle, or a new step",
      }
    );
  }
  for (const claim of request.blockedClaims) {
    questions[`states_claim_before_prerequisites_${claim.id}`] = noul(
      `Does \`candidate_turn\` state, or clearly rely on, this claim: "${claim.text}"?`
    );
  }
  for (const claim of request.contributionTargets) {
    questions[`establishes_planned_claim_${claim.id}`] = noul(
      `Does \`candidate_turn\` establish this claim for listeners: "${claim.text}"?`
    );
  }
  if (Object.keys(questions).length === 0) {
    return { status: "ok", value: { accepted: true } };
  }

  const result = await provider.judge(
    { said_so_far: request.saidSoFar, candidate_turn: request.candidateTurn },
    questions
  );
  if (result.status !== "ok") return result;

  const probabilities = Object.fromEntries(
    Object.entries(result.answers).map(([id, answer]) => [id, answer.probability])
  );
  const decide = (verdict: ClaimGateVerdict): JudgmentDecision<ClaimGateVerdict> => ({
    status: "ok",
    value: verdict,
    detail: { probabilities },
  });

  const prematureClaim = request.blockedClaims.find(
    (claim) =>
      result.answers[`states_claim_before_prerequisites_${claim.id}`].probability >=
      thresholds.prerequisite
  );
  if (prematureClaim) {
    return decide({
      accepted: false,
      reason: `Claim ${prematureClaim.id} appears before its listener prerequisites`,
    });
  }

  const repeats = result.answers.repeats_what_listeners_already_heard;
  if (!repeats || repeats.probability < thresholds.repetition) {
    return decide({ accepted: true });
  }
  const establishesTarget = request.contributionTargets.some(
    (claim) =>
      result.answers[`establishes_planned_claim_${claim.id}`].probability >=
      thresholds.establishesTarget
  );
  return decide(
    establishesTarget
      ? { accepted: true }
      : {
          accepted: false,
          reason: "Candidate substantially repeats claims listeners already heard",
        }
  );
}
