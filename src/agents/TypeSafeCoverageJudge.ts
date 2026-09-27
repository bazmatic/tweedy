import {
  IJudgmentProvider,
  NoulQuestion,
  noul,
} from "../providers/judgment-questions";
import { decide, JudgmentDecision } from "../services/decide";
import { getJudgmentProvider } from "../services/judgment-runtime";

/**
 * Which coverage check is being made. Each is a separate judgment
 * (`coverage.<kind>`) with its own rubric below.
 */
export type CoverageKind = "point" | "orientation" | "discourse";

export interface CoverageItem {
  id: string;
  text: string;
}

export interface CoverageRequest {
  kind: CoverageKind;
  items: CoverageItem[];
  /** Accepted conversation transcript so far. */
  transcript: string;
  /** A turn being considered for acceptance (discourse checks only). */
  candidateTurn?: string;
}

export interface CoverageJudgeDeps {
  provider?: IJudgmentProvider;
  /** Minimum probability for an item to count as covered. */
  threshold?: number;
}

export const DEFAULT_COVERAGE_THRESHOLD = 0.5;

const RUBRICS: Record<CoverageKind, (text: string) => string> = {
  point: (text) =>
    `A podcast director claims this discussion point was covered: "${text}". ` +
    "Was it explicitly and substantively discussed in `transcript`, with specific detail from the point's own text? " +
    "A merely topically-adjacent mention does not count: if the point is \"CO2 scrubber duct-tape hack\" and the transcript only mentions an oxygen tank explosion, the point is not covered.",
  orientation: (text) =>
    `Is this foundational orientation claim clearly established by \`transcript\`: "${text}"? ` +
    "A new listener must be able to recover the claim's complete meaning from the transcript. " +
    "Mere keyword mentions, implications, scattered fragments, or assumed prior knowledge do not count.",
  discourse: (text) =>
    `Is this atomic discourse claim clearly established by \`transcript\` (together with \`candidate_turn\`, if present): "${text}"? ` +
    "Its complete causal or explanatory meaning must be recoverable by a new listener. " +
    "A teaser, keyword, unexplained proper noun, consequence without its cause, or question that assumes the answer does not establish a claim.",
};

const CRITERIA = {
  true: "The complete meaning is explicitly and substantively established",
  false: "Absent, only hinted at, or only topically adjacent",
};

/** Confirms which items the conversation has genuinely covered. */
export function verifyCoverage(
  request: CoverageRequest,
  deps: CoverageJudgeDeps = {}
): Promise<string[]> {
  return decide({
    judgment: `coverage.${request.kind}`,
    ask: () =>
      judgeCoverageWithTypeSafe(
        request,
        deps.provider ?? getJudgmentProvider(),
        deps.threshold ?? DEFAULT_COVERAGE_THRESHOLD
      ),
    fallback: [],
    state: { items: request.items, ...(request.candidateTurn ? { candidateTurn: request.candidateTurn } : {}) },
  });
}

export async function judgeCoverageWithTypeSafe(
  request: CoverageRequest,
  provider: IJudgmentProvider,
  threshold: number
): Promise<JudgmentDecision<string[]>> {
  if (request.items.length === 0) {
    return { status: "ok", value: [] };
  }

  // Question ids are only for mapping answers back; they are not sent as
  // meaning, so each question carries the item text itself.
  const questions: Record<string, NoulQuestion> = {};
  request.items.forEach((item, index) => {
    questions[`item_${index}`] = noul(RUBRICS[request.kind](item.text), CRITERIA);
  });

  const result = await provider.judge(
    {
      transcript: request.transcript || "(nothing said yet)",
      ...(request.candidateTurn ? { candidate_turn: request.candidateTurn } : {}),
    },
    questions
  );
  if (result.status !== "ok") return result;

  const probabilities: Record<string, number> = {};
  const confirmed: string[] = [];
  request.items.forEach((item, index) => {
    const probability = result.answers[`item_${index}`].probability;
    probabilities[item.id] = probability;
    if (probability >= threshold) confirmed.push(item.id);
  });

  return { status: "ok", value: confirmed, detail: { probabilities } };
}
