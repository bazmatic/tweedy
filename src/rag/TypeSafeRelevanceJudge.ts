import { Document } from "../types";
import { IJudgmentProvider, score, ScoreQuestion } from "../providers/judgment-questions";
import { JudgmentRunner, TypeSafeDecision } from "../services/JudgmentRunner";
import {
  getJudgmentProvider,
  getJudgmentRunner,
} from "../services/judgment-runtime";

export const RAG_RELEVANCE_JUDGMENT = "rag-relevance";

/** Ordered relevance levels, lowest first. */
const RELEVANCE_LEVELS = [
  "Unrelated to the query",
  "Same broad topic, but does not help with the query",
  "Partly relevant: contains some information useful for the query",
  "Directly relevant: substantially answers or informs the query",
];

/**
 * Minimum Score position to keep a document: between "same broad topic"
 * and "partly relevant", so tangential matches are dropped rather than
 * padding the context just because they were the nearest vectors.
 */
export const DEFAULT_RELEVANCE_FLOOR = 1.5;

/** Documents are judged on an excerpt; long materials are stored whole. */
const MAX_JUDGED_CHARS = 2000;

export interface RelevanceRequest {
  query: string;
  /** Similarity-ranked candidates, nearest first. */
  candidates: Document[];
  limit: number;
  /** Today's result: the top `limit` candidates by similarity. */
  current: () => Promise<Document[]>;
}

/**
 * Reranks retrieved documents through the `rag-relevance` judgment: a Score
 * per candidate, a relevance floor, then the top `limit` by score.
 */
export function rerankByRelevance(
  request: RelevanceRequest,
  deps: { runner?: JudgmentRunner; provider?: IJudgmentProvider; floor?: number } = {}
): Promise<Document[]> {
  const runner = deps.runner ?? getJudgmentRunner();
  return runner.run({
    judgment: RAG_RELEVANCE_JUDGMENT,
    current: request.current,
    typesafe: () =>
      rerankByRelevanceWithTypeSafe(
        request,
        deps.provider ?? getJudgmentProvider(),
        deps.floor ?? DEFAULT_RELEVANCE_FLOOR
      ),
    state: { query: request.query, candidateIds: request.candidates.map((doc) => doc.id) },
    // Agreement on which documents are returned, not their order.
    agrees: (current, typesafe) =>
      [...current.map((doc) => doc.id)].sort().join() ===
      [...typesafe.map((doc) => doc.id)].sort().join(),
  });
}

export async function rerankByRelevanceWithTypeSafe(
  request: RelevanceRequest,
  provider: IJudgmentProvider,
  floor: number
): Promise<TypeSafeDecision<Document[]>> {
  const { candidates } = request;
  if (candidates.length === 0) return { status: "ok", value: [] };

  const questions: Record<string, ScoreQuestion> = {};
  candidates.forEach((_doc, index) => {
    questions[`relevance_of_document_${index}`] = score(
      `How relevant is \`documents[${index}]\` to \`query\`?`,
      RELEVANCE_LEVELS
    );
  });

  const result = await provider.judge(
    {
      query: request.query,
      documents: candidates.map((doc) => doc.content.slice(0, MAX_JUDGED_CHARS)),
    },
    questions
  );
  if (result.status !== "ok") return result;

  const scored = candidates.map((doc, index) => ({
    doc,
    relevance: result.answers[`relevance_of_document_${index}`].score,
  }));
  const kept = scored
    .filter(({ relevance }) => relevance >= floor)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, request.limit)
    .map(({ doc }) => doc);

  return {
    status: "ok",
    value: kept,
    detail: {
      relevance: Object.fromEntries(scored.map(({ doc, relevance }) => [doc.id, relevance])),
    },
  };
}
