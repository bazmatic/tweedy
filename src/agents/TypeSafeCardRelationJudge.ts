import { CardRelationType, EditorialCard } from "../types";
import { choice, ChoiceQuestion, IJudgmentProvider } from "../providers/judgment-questions";
import { JudgmentRunner, TypeSafeDecision } from "../services/JudgmentRunner";
import {
  getJudgmentProvider,
  getJudgmentRunner,
} from "../services/judgment-runtime";
import { CardRelationExtractionInput } from "./editorial-schemas";

export const CARD_RELATIONS_JUDGMENT = "card-relations";

type RelationEdge = CardRelationExtractionInput["edges"][number];

const NO_CONNECTION = "no_meaningful_connection";

/** The relation types are the option names; each criterion doubles as the edge's rationale. */
const RELATION_CRITERIA: Record<CardRelationType | typeof NO_CONNECTION, string> = {
  [CardRelationType.Supports]: "One card gives evidence or backing for another card's claim",
  [CardRelationType.Contrasts]: "The cards pull in different directions: a tension, contradiction, or counterpoint",
  [CardRelationType.CausesOrLeadsTo]: "One card's event or fact causes or leads to another's",
  [CardRelationType.SharesConcept]: "The cards approach the same underlying concept from different angles",
  [CardRelationType.Extends]: "One card builds on or adds detail to another",
  [CardRelationType.AnswersQuestion]: "One card answers a question another card raises",
  [NO_CONNECTION]: "The cards were flagged as similar but do not meaningfully connect",
};

export interface CardRelationRequest {
  /** Embedding-shortlisted candidate groups (2-4 cards each). */
  candidateGroups: Pick<EditorialCard, "id" | "content" | "significance">[][];
  /** Today's LLM extraction. */
  current: () => Promise<RelationEdge[]>;
}

/**
 * Labels shortlisted card groups through the `card-relations` judgment: one
 * Choice per group over the relation types or no_meaningful_connection. A
 * related group becomes one edge over all its cards.
 */
export function extractCardRelations(
  request: CardRelationRequest,
  deps: { runner?: JudgmentRunner; provider?: IJudgmentProvider } = {}
): Promise<RelationEdge[]> {
  const runner = deps.runner ?? getJudgmentRunner();
  return runner.run({
    judgment: CARD_RELATIONS_JUDGMENT,
    current: request.current,
    typesafe: () =>
      extractCardRelationsWithTypeSafe(request, deps.provider ?? getJudgmentProvider()),
    state: { groups: request.candidateGroups.map((group) => group.map((card) => card.id)) },
    agrees: (current, typesafe) =>
      sameGroupLabels(request.candidateGroups, current, typesafe),
  });
}

export async function extractCardRelationsWithTypeSafe(
  request: CardRelationRequest,
  provider: IJudgmentProvider
): Promise<TypeSafeDecision<RelationEdge[]>> {
  const { candidateGroups } = request;
  if (candidateGroups.length === 0) return { status: "ok", value: [] };

  const questions: Record<string, ChoiceQuestion> = {};
  candidateGroups.forEach((_group, index) => {
    questions[`relation_within_group_${index}`] = choice(
      `How do the podcast editorial cards in \`groups[${index}]\` genuinely relate to each other? ` +
        "Do not force a relation.",
      RELATION_CRITERIA
    );
  });

  const result = await provider.judge(
    {
      groups: candidateGroups.map((group) =>
        group.map((card) => ({ content: card.content, significance: card.significance }))
      ),
    },
    questions
  );
  if (result.status !== "ok") return result;

  const edges: RelationEdge[] = [];
  const labels: string[] = [];
  candidateGroups.forEach((group, index) => {
    const answer = result.answers[`relation_within_group_${index}`];
    labels.push(`${answer.choice} (${answer.confidence.toFixed(2)})`);
    if (answer.choice === NO_CONNECTION) return;
    const relationType = answer.choice as CardRelationType;
    edges.push({
      cardIds: group.map((card) => card.id),
      relationType,
      rationale: RELATION_CRITERIA[relationType],
    });
  });
  return { status: "ok", value: edges, detail: { labels } };
}

/** Per group: same related/unrelated verdict and, if related, the same type. */
function sameGroupLabels(
  groups: Pick<EditorialCard, "id">[][],
  current: RelationEdge[],
  typesafe: RelationEdge[]
): boolean {
  const labelFor = (edges: RelationEdge[], group: Pick<EditorialCard, "id">[]) => {
    const ids = new Set(group.map((card) => card.id));
    const edge = edges.find((candidate) =>
      candidate.cardIds.filter((id) => ids.has(id)).length >= 2
    );
    return edge?.relationType ?? NO_CONNECTION;
  };
  return groups.every((group) => labelFor(current, group) === labelFor(typesafe, group));
}
