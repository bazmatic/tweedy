import { describe, expect, it, vi } from "vitest";
import { CardGraphService } from "./CardGraphService";
import { CardRelationType, EditorialCard, EditorialCardKind, EmbeddingService } from "../types";

function makeCard(overrides: Partial<EditorialCard>): EditorialCard {
  return {
    id: "id",
    materialId: "m1",
    kind: EditorialCardKind.EssentialPoint,
    content: "content",
    significance: "significance",
    evidence: [],
    relatedCardIds: [],
    tags: [],
    keyTerms: [],
    storyValue: 5,
    ...overrides,
  };
}

function makeEmbeddings(vectors: number[][]): EmbeddingService {
  return {
    embedText: vi.fn(),
    embedDocuments: vi.fn().mockResolvedValue(vectors),
  };
}

describe("CardGraphService", () => {
  it("returns no edges without embedding when fewer than 2 cards are given", async () => {
    const embeddings = makeEmbeddings([]);
    const repository = { create: vi.fn(), findByCardId: vi.fn(), findByScriptId: vi.fn() };
    const relationExtractor = { extractRelations: vi.fn() };
    const service = new CardGraphService(repository as any, embeddings, relationExtractor as any);

    const edges = await service.build("script-1", [makeCard({ id: "m1-card-1" })]);

    expect(edges).toEqual([]);
    expect(embeddings.embedDocuments).not.toHaveBeenCalled();
  });

  it("finds a cross-material candidate pair, sends it to the extractor, and persists an accepted edge", async () => {
    const cardA = makeCard({ id: "m1-card-1", materialId: "m1", content: "A", significance: "sig A" });
    const cardB = makeCard({ id: "m2-card-1", materialId: "m2", content: "B", significance: "sig B" });
    // Identical vectors -> cosine similarity 1, well above both thresholds.
    const embeddings = makeEmbeddings([[1, 0], [1, 0]]);
    const savedEdge = {
      id: "edge-1",
      scriptId: "script-1",
      cardIds: ["m1-card-1", "m2-card-1"],
      relationType: CardRelationType.SharesConcept,
      rationale: "Same idea.",
      weight: 1,
    };
    const repository = {
      create: vi.fn().mockResolvedValue(savedEdge),
      findByCardId: vi.fn(),
      findByScriptId: vi.fn(),
    };
    const relationExtractor = {
      extractRelations: vi.fn().mockResolvedValue([
        {
          cardIds: ["m1-card-1", "m2-card-1"],
          relationType: CardRelationType.SharesConcept,
          rationale: "Same idea.",
        },
      ]),
    };
    const service = new CardGraphService(repository as any, embeddings, relationExtractor as any);

    const edges = await service.build("script-1", [cardA, cardB]);

    expect(edges).toEqual([savedEdge]);
    expect(relationExtractor.extractRelations).toHaveBeenCalledWith([[cardA, cardB]]);
    expect(repository.create).toHaveBeenCalledWith({
      scriptId: "script-1",
      cardIds: ["m1-card-1", "m2-card-1"],
      relationType: CardRelationType.SharesConcept,
      rationale: "Same idea.",
      weight: 1,
    });
    expect(cardA.relatedCardIds).toEqual(["m2-card-1"]);
    expect(cardB.relatedCardIds).toEqual(["m1-card-1"]);
  });

  it("discards an extracted edge referencing an unknown card id", async () => {
    const cardA = makeCard({ id: "m1-card-1", materialId: "m1" });
    const cardB = makeCard({ id: "m2-card-1", materialId: "m2" });
    const embeddings = makeEmbeddings([[1, 0], [1, 0]]);
    const repository = { create: vi.fn(), findByCardId: vi.fn(), findByScriptId: vi.fn() };
    const relationExtractor = {
      extractRelations: vi.fn().mockResolvedValue([
        {
          cardIds: ["m1-card-1", "does-not-exist"],
          relationType: CardRelationType.SharesConcept,
          rationale: "Bad edge.",
        },
      ]),
    };
    const service = new CardGraphService(repository as any, embeddings, relationExtractor as any);

    const edges = await service.build("script-1", [cardA, cardB]);

    expect(edges).toEqual([]);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("fails open and returns no edges if embedding throws", async () => {
    const cardA = makeCard({ id: "m1-card-1", materialId: "m1" });
    const cardB = makeCard({ id: "m2-card-1", materialId: "m2" });
    const embeddings: EmbeddingService = {
      embedText: vi.fn(),
      embedDocuments: vi.fn().mockRejectedValue(new Error("embedding unavailable")),
    };
    const repository = { create: vi.fn(), findByCardId: vi.fn(), findByScriptId: vi.fn() };
    const relationExtractor = { extractRelations: vi.fn() };
    const service = new CardGraphService(repository as any, embeddings, relationExtractor as any);

    const edges = await service.build("script-1", [cardA, cardB]);

    expect(edges).toEqual([]);
  });

  it("getConnections delegates to the repository and fails open on error", async () => {
    const found = [{ id: "edge-1" }];
    const repository = {
      create: vi.fn(),
      findByCardId: vi.fn().mockResolvedValueOnce(found).mockRejectedValueOnce(new Error("io error")),
      findByScriptId: vi.fn(),
    };
    const service = new CardGraphService(repository as any, makeEmbeddings([]), { extractRelations: vi.fn() } as any);

    await expect(service.getConnections("script-1", "m1-card-1")).resolves.toBe(found as any);
    await expect(service.getConnections("script-1", "m1-card-1")).resolves.toEqual([]);
  });
});
