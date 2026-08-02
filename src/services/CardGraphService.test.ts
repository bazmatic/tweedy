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
    // One group -> a token budget sized from the group count, not a fixed constant.
    expect(relationExtractor.extractRelations).toHaveBeenCalledWith([[cardA, cardB]], 260);
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

  it("keeps building when the model proposes the same member set twice", async () => {
    const cardA = makeCard({ id: "m1-card-1", materialId: "m1" });
    const cardB = makeCard({ id: "m2-card-1", materialId: "m2" });
    const embeddings = makeEmbeddings([[1, 0], [1, 0]]);
    const repository = {
      create: vi.fn().mockResolvedValue({ id: "edge-1" }),
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
        // Same members, reversed order — a duplicate, not a second edge.
        {
          cardIds: ["m2-card-1", "m1-card-1"],
          relationType: CardRelationType.Contrasts,
          rationale: "Restated by the model.",
        },
      ]),
    };
    const service = new CardGraphService(repository as any, embeddings, relationExtractor as any);

    const edges = await service.build("script-1", [cardA, cardB]);

    expect(repository.create).toHaveBeenCalledTimes(1);
    expect(edges).toEqual([{ id: "edge-1" }]);
  });

  it("returns the edges already persisted when a later create fails", async () => {
    const cardA = makeCard({ id: "m1-card-1", materialId: "m1" });
    const cardB = makeCard({ id: "m2-card-1", materialId: "m2" });
    const cardC = makeCard({ id: "m3-card-1", materialId: "m3" });
    const embeddings = makeEmbeddings([[1, 0], [1, 0], [1, 0]]);
    const savedEdge = { id: "edge-1" };
    const repository = {
      create: vi
        .fn()
        .mockResolvedValueOnce(savedEdge)
        .mockRejectedValueOnce(new Error("disk full")),
      findByCardId: vi.fn(),
      findByScriptId: vi.fn(),
    };
    const relationExtractor = {
      extractRelations: vi.fn().mockResolvedValue([
        {
          cardIds: ["m1-card-1", "m2-card-1"],
          relationType: CardRelationType.SharesConcept,
          rationale: "One.",
        },
        {
          cardIds: ["m1-card-1", "m3-card-1"],
          relationType: CardRelationType.SharesConcept,
          rationale: "Two.",
        },
      ]),
    };
    const service = new CardGraphService(repository as any, embeddings, relationExtractor as any);

    const edges = await service.build("script-1", [cardA, cardB, cardC]);

    expect(edges).toEqual([savedEdge]);
  });

  it("caps a large mutually-similar cluster at the maximum group size", async () => {
    const cards = Array.from({ length: 6 }, (_, index) =>
      makeCard({ id: `m${index + 1}-card-1`, materialId: `m${index + 1}` })
    );
    // Identical direction for every card -> one union-find cluster of 6.
    const embeddings = makeEmbeddings(cards.map(() => [1, 0]));
    const repository = { create: vi.fn(), findByCardId: vi.fn(), findByScriptId: vi.fn() };
    const relationExtractor = { extractRelations: vi.fn().mockResolvedValue([]) };
    const service = new CardGraphService(repository as any, embeddings, relationExtractor as any);

    await service.build("script-1", cards);

    const [groups] = relationExtractor.extractRelations.mock.calls[0];
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      expect(group.length).toBeGreaterThanOrEqual(2);
      expect(group.length).toBeLessThanOrEqual(4);
    }
  });

  it("never proposes a pair of cards from the same material", async () => {
    const cardA = makeCard({ id: "m1-card-1", materialId: "m1" });
    const cardB = makeCard({ id: "m1-card-2", materialId: "m1" });
    const embeddings = makeEmbeddings([[1, 0], [1, 0]]);
    const repository = { create: vi.fn(), findByCardId: vi.fn(), findByScriptId: vi.fn() };
    const relationExtractor = { extractRelations: vi.fn().mockResolvedValue([]) };
    const service = new CardGraphService(repository as any, embeddings, relationExtractor as any);

    const edges = await service.build("script-1", [cardA, cardB]);

    expect(edges).toEqual([]);
    expect(relationExtractor.extractRelations).not.toHaveBeenCalled();
  });

  it("rejects a cross-material pair below the prefilter similarity threshold", async () => {
    const cardA = makeCard({ id: "m1-card-1", materialId: "m1" });
    const cardB = makeCard({ id: "m2-card-1", materialId: "m2" });
    // Orthogonal vectors -> cosine similarity 0, below the 0.55 prefilter.
    const embeddings = makeEmbeddings([[1, 0], [0, 1]]);
    const repository = { create: vi.fn(), findByCardId: vi.fn(), findByScriptId: vi.fn() };
    const relationExtractor = { extractRelations: vi.fn().mockResolvedValue([]) };
    const service = new CardGraphService(repository as any, embeddings, relationExtractor as any);

    const edges = await service.build("script-1", [cardA, cardB]);

    expect(edges).toEqual([]);
    expect(relationExtractor.extractRelations).not.toHaveBeenCalled();
  });

  it("caps the number of candidate groups sent to the extractor", async () => {
    // 12 mutually similar cross-material cards produce far more leftover pair
    // groups than the extractor's budget allows.
    const cards = Array.from({ length: 12 }, (_, index) =>
      makeCard({ id: `m${index + 1}-card-1`, materialId: `m${index + 1}` })
    );
    const embeddings = makeEmbeddings(cards.map(() => [1, 0]));
    const repository = { create: vi.fn(), findByCardId: vi.fn(), findByScriptId: vi.fn() };
    const relationExtractor = { extractRelations: vi.fn().mockResolvedValue([]) };
    const service = new CardGraphService(repository as any, embeddings, relationExtractor as any);

    await service.build("script-1", cards);

    const [groups, maxTokens] = relationExtractor.extractRelations.mock.calls[0];
    expect(groups).toHaveLength(30);
    expect(maxTokens).toBe(2000);
  });

  it("getConnections loads a script's edges once and filters them in memory", async () => {
    const edgeA = { id: "edge-1", scriptId: "script-1", cardIds: ["m1-card-1", "m2-card-1"] };
    const edgeB = { id: "edge-2", scriptId: "script-1", cardIds: ["m3-card-1", "m4-card-1"] };
    const repository = {
      create: vi.fn(),
      findByCardId: vi.fn(),
      findByScriptId: vi.fn().mockResolvedValue([edgeA, edgeB]),
    };
    const service = new CardGraphService(repository as any, makeEmbeddings([]), {
      extractRelations: vi.fn(),
    } as any);

    await expect(service.getConnections("script-1", "m1-card-1")).resolves.toEqual([edgeA]);
    await expect(service.getConnections("script-1", "m3-card-1")).resolves.toEqual([edgeB]);
    await expect(service.getConnections("script-1", "unknown-card")).resolves.toEqual([]);

    expect(repository.findByScriptId).toHaveBeenCalledTimes(1);
    expect(repository.findByCardId).not.toHaveBeenCalled();
  });

  it("getConnections serves edges cached by build without re-reading them", async () => {
    const cardA = makeCard({ id: "m1-card-1", materialId: "m1" });
    const cardB = makeCard({ id: "m2-card-1", materialId: "m2" });
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
    const service = new CardGraphService(repository as any, makeEmbeddings([[1, 0], [1, 0]]), relationExtractor as any);

    await service.build("script-1", [cardA, cardB]);

    await expect(service.getConnections("script-1", "m1-card-1")).resolves.toEqual([savedEdge]);
    expect(repository.findByScriptId).not.toHaveBeenCalled();
  });

  it("getConnections fails open when the repository throws", async () => {
    const repository = {
      create: vi.fn(),
      findByCardId: vi.fn(),
      findByScriptId: vi.fn().mockRejectedValue(new Error("io error")),
    };
    const service = new CardGraphService(repository as any, makeEmbeddings([]), {
      extractRelations: vi.fn(),
    } as any);

    await expect(service.getConnections("script-1", "m1-card-1")).resolves.toEqual([]);
  });
});
