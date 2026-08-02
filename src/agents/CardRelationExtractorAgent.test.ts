import { describe, expect, it, vi } from "vitest";
import { CardRelationExtractorAgent } from "./CardRelationExtractorAgent";
import { ModelTask } from "../providers/ModelRoutingPolicy";
import { CardRelationType, EditorialCard, EditorialCardKind } from "../types";

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

describe("CardRelationExtractorAgent", () => {
  it("returns an empty list without calling the model when there are no candidate groups", async () => {
    const agent = new CardRelationExtractorAgent();
    const callModel = vi.spyOn(agent as any, "callModelForStructuredOutput");

    const edges = await agent.extractRelations([]);

    expect(edges).toEqual([]);
    expect(callModel).not.toHaveBeenCalled();
  });

  it("sends one batched call listing every candidate group and returns the model's edges", async () => {
    const agent = new CardRelationExtractorAgent();
    const groupA = [
      makeCard({ id: "m1-card-2", materialId: "m1", content: "Feedback loop in system A." }),
      makeCard({ id: "m3-card-1", materialId: "m3", content: "Feedback loop in system B." }),
    ];
    const callModel = vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValue({
      edges: [
        {
          cardIds: ["m1-card-2", "m3-card-1"],
          relationType: CardRelationType.SharesConcept,
          rationale: "Both describe the same feedback loop.",
        },
      ],
    });

    const edges = await agent.extractRelations([groupA]);

    expect(edges).toEqual([
      {
        cardIds: ["m1-card-2", "m3-card-1"],
        relationType: CardRelationType.SharesConcept,
        rationale: "Both describe the same feedback loop.",
      },
    ]);
    expect(callModel.mock.calls[0][0]).toBe(ModelTask.CardRelationExtraction);
    const promptContent = (callModel.mock.calls[0][1] as any)[0].content as string;
    expect(promptContent).toContain("m1-card-2");
    expect(promptContent).toContain("m3-card-1");
    expect(promptContent).toContain("Feedback loop in system A.");
  });
});
