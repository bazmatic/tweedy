import { PodcastMaterial, ResearchMaterial } from "../types";
import { IJudgmentProvider, noul, NoulQuestion } from "../providers/judgment-questions";
import { JudgmentRunner, TypeSafeDecision } from "./JudgmentRunner";
import { getJudgmentProvider, getJudgmentRunner } from "./judgment-runtime";

export const RESEARCH_FILTER_JUDGMENT = "research-filter";
export const DEFAULT_RESEARCH_FILTER_THRESHOLD = 0.5;

/** Research results are judged on an excerpt. */
const MAX_JUDGED_CHARS = 3000;
/** Only the most recent materials are checked for duplication. */
const MAX_EXISTING_MATERIALS = 20;

export interface RejectedResearch {
  title: string;
  reason: string;
}

export interface ResearchFilterRequest {
  query: string;
  results: ResearchMaterial[];
  /** Loaded only when the TypeSafe path runs. */
  loadExistingMaterials: () => Promise<PodcastMaterial[]>;
}

/**
 * Decides which research results not to add as material, through the
 * `research-filter` judgment. Today nothing is filtered, so that is the
 * current path. Rejections carry a reason for the caller to report.
 */
export function filterResearch(
  request: ResearchFilterRequest,
  deps: { runner?: JudgmentRunner; provider?: IJudgmentProvider; threshold?: number } = {}
): Promise<RejectedResearch[]> {
  const runner = deps.runner ?? getJudgmentRunner();
  return runner.run({
    judgment: RESEARCH_FILTER_JUDGMENT,
    current: async () => [],
    typesafe: () =>
      filterResearchWithTypeSafe(
        request,
        deps.provider ?? getJudgmentProvider(),
        deps.threshold ?? DEFAULT_RESEARCH_FILTER_THRESHOLD
      ),
    state: { query: request.query, results: request.results.map((r) => r.title) },
    agrees: (current, typesafe) =>
      current.map((r) => r.title).sort().join() === typesafe.map((r) => r.title).sort().join(),
  });
}

export async function filterResearchWithTypeSafe(
  request: ResearchFilterRequest,
  provider: IJudgmentProvider,
  threshold: number
): Promise<TypeSafeDecision<RejectedResearch[]>> {
  if (request.results.length === 0) return { status: "ok", value: [] };
  const existing = (await request.loadExistingMaterials()).slice(-MAX_EXISTING_MATERIALS);

  const questions: Record<string, NoulQuestion> = {};
  request.results.forEach((_result, index) => {
    questions[`result_${index}_addresses_the_query`] = noul(
      `Does \`results[${index}]\` actually address \`query\`, rather than drifting to a different subject?`
    );
    questions[`result_${index}_is_grounded_in_its_sources`] = noul(
      `Is \`results[${index}]\` grounded in the sources cited with it, rather than speculation or unsupported claims?`
    );
    if (existing.length > 0) {
      questions[`result_${index}_repeats_existing_material`] = noul(
        `Does \`results[${index}]\` mostly repeat one of \`existing_materials\` without adding new information?`
      );
    }
  });

  const result = await provider.judge(
    {
      query: request.query,
      results: request.results.map((r) => ({
        title: r.title,
        content: r.content.slice(0, MAX_JUDGED_CHARS),
        citations: Array.isArray(r.metadata?.citations) ? r.metadata.citations : [],
      })),
      ...(existing.length > 0
        ? {
            existing_materials: existing.map((m) => ({
              title: m.title,
              excerpt: m.content.slice(0, 500),
            })),
          }
        : {}),
    },
    questions
  );
  if (result.status !== "ok") return result;

  const probability = (id: string) => result.answers[id]?.probability;
  const rejected: RejectedResearch[] = [];
  request.results.forEach((r, index) => {
    // Each failed check with how decisively it failed; all are reported,
    // strongest first, so a result that is both off-topic and uncited says so.
    const failures: { reason: string; strength: number }[] = [];
    const addresses = probability(`result_${index}_addresses_the_query`)!;
    const grounded = probability(`result_${index}_is_grounded_in_its_sources`)!;
    const repeats = probability(`result_${index}_repeats_existing_material`) ?? 0;
    if (addresses < threshold) {
      failures.push({ reason: "does not address the research query", strength: 1 - addresses });
    }
    if (grounded < threshold) {
      failures.push({ reason: "not grounded in its cited sources", strength: 1 - grounded });
    }
    if (repeats >= threshold) {
      failures.push({ reason: "mostly repeats existing material", strength: repeats });
    }
    if (failures.length === 0) return;
    failures.sort((a, b) => b.strength - a.strength);
    rejected.push({ title: r.title, reason: failures.map((f) => f.reason).join("; ") });
  });

  return {
    status: "ok",
    value: rejected,
    detail: {
      probabilities: Object.fromEntries(
        Object.entries(result.answers).map(([id, answer]) => [id, answer.probability])
      ),
    },
  };
}
