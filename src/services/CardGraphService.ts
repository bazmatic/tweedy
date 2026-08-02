import { CardHyperedge, EditorialCard, EmbeddingService } from "../types";
import { LocalEmbeddingService } from "../rag/LocalEmbeddingService";
import { CardGraphRepository } from "../repositories/CardGraphRepository";
import { CardRelationExtractorAgent } from "../agents/CardRelationExtractorAgent";
import { logger } from "../utils/logger";

const PREFILTER_SIMILARITY = 0.55;
const CLUSTER_SIMILARITY = 0.75;
const TOP_K_PER_CARD = 5;
const MAX_GROUP_SIZE = 4;
/**
 * Hard cap on how many candidate groups reach the relation extractor. Without
 * it, a multi-material episode produces one leftover group per unmerged pair in
 * the 0.55-0.75 band — easily 50-100+ groups — which overruns the extractor's
 * token budget and truncates its structured output.
 */
const MAX_CANDIDATE_GROUPS = 30;

interface CandidatePair {
  aId: string;
  bId: string;
  score: number;
}

/** A candidate group plus the strongest pairwise similarity inside it, used to
 * rank groups when more are found than {@link MAX_CANDIDATE_GROUPS}. */
interface ScoredGroup {
  cardIds: string[];
  score: number;
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

class UnionFind {
  private readonly parent = new Map<string, string>();

  add(id: string): void {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }

  find(id: string): string {
    const parent = this.parent.get(id) ?? id;
    if (parent === id) return id;
    const root = this.find(parent);
    this.parent.set(id, root);
    return root;
  }

  union(a: string, b: string): void {
    this.add(a);
    this.add(b);
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootA, rootB);
  }
}

function findCandidatePairs(cards: EditorialCard[], vectors: number[][]): CandidatePair[] {
  const seen = new Set<string>();
  const pairs: CandidatePair[] = [];

  for (let i = 0; i < cards.length; i += 1) {
    const scored = cards
      .map((other, j) => ({ other, j }))
      .filter(({ other, j }) => j !== i && other.materialId !== cards[i].materialId)
      .map(({ other, j }) => ({ id: other.id, score: cosineSimilarity(vectors[i], vectors[j]) }))
      .filter(({ score }) => score > PREFILTER_SIMILARITY)
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_K_PER_CARD);

    for (const { id, score } of scored) {
      const key = [cards[i].id, id].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ aId: cards[i].id, bId: id, score });
    }
  }

  return pairs;
}

function capGroupSize(members: string[], pairs: CandidatePair[]): string[] {
  if (members.length <= MAX_GROUP_SIZE) return members;
  const connectivity = new Map<string, number>(members.map((id) => [id, 0]));
  for (const pair of pairs) {
    if (members.includes(pair.aId) && members.includes(pair.bId)) {
      connectivity.set(pair.aId, (connectivity.get(pair.aId) ?? 0) + pair.score);
      connectivity.set(pair.bId, (connectivity.get(pair.bId) ?? 0) + pair.score);
    }
  }
  return [...members]
    .sort((a, b) => (connectivity.get(b) ?? 0) - (connectivity.get(a) ?? 0))
    .slice(0, MAX_GROUP_SIZE);
}

function clusterIntoGroups(pairs: CandidatePair[]): ScoredGroup[] {
  const unionFind = new UnionFind();
  for (const pair of pairs) {
    if (pair.score > CLUSTER_SIMILARITY) unionFind.union(pair.aId, pair.bId);
  }

  const cardIds = new Set(pairs.flatMap((pair) => [pair.aId, pair.bId]));
  const membersByRoot = new Map<string, Set<string>>();
  for (const id of cardIds) {
    unionFind.add(id);
    const root = unionFind.find(id);
    if (!membersByRoot.has(root)) membersByRoot.set(root, new Set());
    membersByRoot.get(root)!.add(id);
  }

  const groups: ScoredGroup[] = [];
  const consumed = new Set<string>();

  for (const members of membersByRoot.values()) {
    if (members.size < 2) continue;
    const capped = capGroupSize([...members], pairs);
    let score = 0;
    for (const pair of pairs) {
      if (capped.includes(pair.aId) && capped.includes(pair.bId)) {
        consumed.add([pair.aId, pair.bId].sort().join("|"));
        score = Math.max(score, pair.score);
      }
    }
    groups.push({ cardIds: capped, score });
  }

  for (const pair of pairs) {
    const key = [pair.aId, pair.bId].sort().join("|");
    if (consumed.has(key)) continue;
    consumed.add(key);
    groups.push({ cardIds: [pair.aId, pair.bId], score: pair.score });
  }

  return groups;
}

export class CardGraphService {
  /** Per-script hyperedge cache. `getConnections` is called once per
   * last-mentioned card on every conversational turn, and the underlying
   * repository lookup scans every hyperedge file ever written across all
   * scripts — so it is loaded once per script and filtered in memory. */
  private readonly edgesByScript = new Map<string, CardHyperedge[]>();

  constructor(
    private readonly repository: CardGraphRepository = new CardGraphRepository(),
    private readonly embeddingService: EmbeddingService = new LocalEmbeddingService(),
    private readonly relationExtractor: CardRelationExtractorAgent = new CardRelationExtractorAgent()
  ) {}

  async build(scriptId: string, cards: EditorialCard[]): Promise<CardHyperedge[]> {
    if (cards.length < 2) return [];

    // Declared outside the try so a mid-loop persistence failure still reports
    // the edges already durably written, rather than claiming none exist while
    // later turns read them back off disk.
    const edges: CardHyperedge[] = [];
    try {
      const vectors = await this.embeddingService.embedDocuments(
        cards.map((card) => `${card.content} ${card.significance}`)
      );
      const pairs = findCandidatePairs(cards, vectors);
      if (pairs.length === 0) return [];

      const groups = clusterIntoGroups(pairs)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_CANDIDATE_GROUPS);
      const cardsById = new Map(cards.map((card) => [card.id, card]));
      const vectorById = new Map(cards.map((card, index) => [card.id, vectors[index]]));

      const candidateCardGroups = groups.map((group) =>
        group.cardIds.map((id) => cardsById.get(id)!)
      );
      const maxTokens = Math.min(4000, 200 + groups.length * 60);
      const extracted = await this.relationExtractor.extractRelations(
        candidateCardGroups,
        maxTokens
      );

      const persistedKeys = new Set<string>();
      for (const candidate of extracted) {
        const memberIds = candidate.cardIds.filter((id) => cardsById.has(id));
        if (memberIds.length < 2) continue;

        // The model can emit the same member set twice (in any order); persist
        // it once.
        const key = [...new Set(memberIds)].sort().join("|");
        if (persistedKeys.has(key)) continue;
        persistedKeys.add(key);

        const weight = this.averageSimilarity(memberIds, vectorById);
        const saved = await this.repository.create({
          scriptId,
          cardIds: memberIds,
          relationType: candidate.relationType,
          rationale: candidate.rationale,
          weight,
        });
        edges.push(saved);

        for (const id of memberIds) {
          const card = cardsById.get(id)!;
          const others = memberIds.filter((otherId) => otherId !== id);
          card.relatedCardIds = Array.from(new Set([...card.relatedCardIds, ...others]));
        }
      }
      this.edgesByScript.set(scriptId, edges);
      return edges;
    } catch (error) {
      logger.warn("Card graph construction unavailable; skipping", error);
      return edges;
    }
  }

  async getConnections(scriptId: string, cardId: string): Promise<CardHyperedge[]> {
    try {
      const edges = await this.getScriptEdges(scriptId);
      return edges.filter((edge) => edge.cardIds.includes(cardId));
    } catch (error) {
      logger.warn("Card graph lookup unavailable", error);
      return [];
    }
  }

  private async getScriptEdges(scriptId: string): Promise<CardHyperedge[]> {
    const cached = this.edgesByScript.get(scriptId);
    if (cached) return cached;
    const edges = await this.repository.findByScriptId(scriptId);
    this.edgesByScript.set(scriptId, edges);
    return edges;
  }

  private averageSimilarity(memberIds: string[], vectorById: Map<string, number[]>): number {
    const scores: number[] = [];
    for (let i = 0; i < memberIds.length; i += 1) {
      for (let j = i + 1; j < memberIds.length; j += 1) {
        const a = vectorById.get(memberIds[i]);
        const b = vectorById.get(memberIds[j]);
        if (a && b) scores.push(cosineSimilarity(a, b));
      }
    }
    return scores.length === 0 ? 0 : scores.reduce((sum, s) => sum + s, 0) / scores.length;
  }
}
