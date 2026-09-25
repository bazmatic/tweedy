import { IJudgmentProvider, noul, NoulQuestion } from "../providers/judgment-questions";
import { JudgmentRunner, TypeSafeDecision } from "../services/JudgmentRunner";
import {
  getJudgmentProvider,
  getJudgmentRunner,
} from "../services/judgment-runtime";

export const CLAIM_GATE_JUDGMENT = "claim-gate";
export const DEFAULT_CLAIM_GATE_THRESHOLD = 0.5;

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
  /** Today's embedding-similarity gate. */
  current: () => Promise<ClaimGateVerdict>;
}

export interface ClaimGateJudgeDeps {
  runner?: JudgmentRunner;
  provider?: IJudgmentProvider;
  threshold?: number;
}

/**
 * Gates a candidate turn through the `claim-gate` judgment. Same policy as
 * the embedding gate — reject a claim stated before its prerequisites, then
 * reject substantial repetition unless the turn establishes a planned target
 * claim — but each condition is a yes/no over the whole turn, so there is no
 * regex sentence splitting and no hand-tuned similarity threshold.
 */
export function gateClaims(
  request: ClaimGateRequest,
  deps: ClaimGateJudgeDeps = {}
): Promise<ClaimGateVerdict> {
  const runner = deps.runner ?? getJudgmentRunner();
  return runner.run({
    judgment: CLAIM_GATE_JUDGMENT,
    current: request.current,
    typesafe: () =>
      gateClaimsWithTypeSafe(
        request,
        deps.provider ?? getJudgmentProvider(),
        deps.threshold ?? DEFAULT_CLAIM_GATE_THRESHOLD
      ),
    state: {
      candidateTurn: request.candidateTurn,
      blockedClaimIds: request.blockedClaims.map((claim) => claim.id),
      contributionTargetIds: request.contributionTargets.map((claim) => claim.id),
    },
    agrees: (current, typesafe) => current.accepted === typesafe.accepted,
  });
}

export async function gateClaimsWithTypeSafe(
  request: ClaimGateRequest,
  provider: IJudgmentProvider,
  threshold: number
): Promise<TypeSafeDecision<ClaimGateVerdict>> {
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
  const decide = (verdict: ClaimGateVerdict): TypeSafeDecision<ClaimGateVerdict> => ({
    status: "ok",
    value: verdict,
    detail: { probabilities },
  });

  const prematureClaim = request.blockedClaims.find(
    (claim) =>
      result.answers[`states_claim_before_prerequisites_${claim.id}`].probability >= threshold
  );
  if (prematureClaim) {
    return decide({
      accepted: false,
      reason: `Claim ${prematureClaim.id} appears before its listener prerequisites`,
    });
  }

  const repeats = result.answers.repeats_what_listeners_already_heard;
  if (!repeats || repeats.probability < threshold) {
    return decide({ accepted: true });
  }
  const establishesTarget = request.contributionTargets.some(
    (claim) =>
      result.answers[`establishes_planned_claim_${claim.id}`].probability >= threshold
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
