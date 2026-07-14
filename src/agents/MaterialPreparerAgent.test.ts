import { describe, expect, it, vi } from "vitest";
import { EditorialCardKind, SourceType } from "../types";
import { MaterialPreparerAgent } from "./MaterialPreparerAgent";
import { ModelTask } from "../providers/ModelRoutingPolicy";

const material = {
  id: "m1",
  title: "A revealing profile",
  content: "The subject kept the rejection letter above her desk for a decade.",
  source: "manual",
  sourceType: SourceType.Manual,
  metadata: {},
  createdAt: new Date(),
};

describe("MaterialPreparerAgent", () => {
  it("turns subject-neutral material into stable editorial cards", async () => {
    const agent = new MaterialPreparerAgent();
    const callModel = vi.spyOn(agent as any, "callModelForStructuredOutput").mockResolvedValue({
      synopsis: "A profile about persistence and public success.",
      cards: [
        {
          kind: EditorialCardKind.Story,
          content: "She kept an early rejection letter for ten years.",
          excerpts: ["kept the rejection letter above her desk for a decade"],
          tags: ["persistence"],
        },
      ],
    });

    const prepared = await agent.prepare(material, {
      title: "Turning Points",
      description: "Stories about careers changing direction",
    });

    expect(prepared.cards[0]).toEqual(
      expect.objectContaining({
        id: "m1-card-1",
        materialId: "m1",
        kind: EditorialCardKind.Story,
        content: "She kept an early rejection letter for ten years.",
      })
    );
    expect(prepared.cards[0].evidence[0]).toEqual({
      materialId: "m1",
      excerpt: "kept the rejection letter above her desk for a decade",
    });
    expect(callModel.mock.calls[0][0]).toBe(ModelTask.MaterialPreparation);
  });

  it("falls back to a grounded essential-point card if preparation fails", async () => {
    const agent = new MaterialPreparerAgent();
    vi.spyOn(agent as any, "callModelForStructuredOutput").mockRejectedValue(
      new Error("model unavailable")
    );

    const prepared = await agent.prepare(material, {
      title: "Turning Points",
      description: "",
    });

    expect(prepared.cards).toHaveLength(1);
    expect(prepared.cards[0].kind).toBe(EditorialCardKind.EssentialPoint);
    expect(prepared.cards[0].evidence[0].excerpt).toContain("rejection letter");
  });
});
