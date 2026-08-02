import { describe, expect, it } from "vitest";
import { CardRelationType, EditorialCardKind } from "../types";
import {
  cardRelationSchema,
  prepareMaterialSchema,
  reviewTurnSchema,
} from "./editorial-schemas";

describe("editorial structured-output schemas", () => {
  it("validates prepared material and rejects unknown card kinds", () => {
    const input = {
      synopsis: "A concise source summary.",
      cards: [
        {
          kind: EditorialCardKind.EssentialPoint,
          content: "Fungi produce measurable electrical spikes.",
          significance: "Suggests fungi may process information much like nervous systems do.",
          excerpts: ["Electrical spikes were recorded."],
          storyValue: 6,
        },
      ],
    };

    expect(prepareMaterialSchema.parse(input)).toEqual(input);
    expect(() =>
      prepareMaterialSchema.parse({
        ...input,
        cards: [{ ...input.cards[0], kind: "invented_kind" }],
      })
    ).toThrow();
  });

  it("requires every review judgement and validates introduced terms", () => {
    const review = {
      accepted: true,
      clear: true,
      engaging: true,
      grounded: true,
      advancesBeat: true,
      addsVariety: true,
      roleConsistent: true,
      knowledgeConsistent: true,
      audienceAccessible: true,
      castConsistent: true,
      introducedCardIds: [],
      introducedTerms: [
        { term: "hypha", plainLanguageMeaning: "a fungal thread" },
      ],
      feedback: [],
    };

    expect(reviewTurnSchema.parse(review)).toEqual(review);
    expect(() => reviewTurnSchema.parse({ accepted: true })).toThrow();
  });

  it("normalises singular reviewer feedback into an array", () => {
    const parsed = reviewTurnSchema.parse({
      accepted: false,
      clear: false,
      engaging: true,
      grounded: true,
      advancesBeat: false,
      addsVariety: true,
      roleConsistent: true,
      knowledgeConsistent: true,
      audienceAccessible: false,
      castConsistent: true,
      introducedCardIds: [],
      introducedTerms: [],
      feedback: "Add the missing listener context.",
    });

    expect(parsed.feedback).toEqual(["Add the missing listener context."]);
  });

  it("validates card relation edges and rejects single-card groups", () => {
    const input = {
      edges: [
        {
          cardIds: ["m1-card-2", "m3-card-1"],
          relationType: CardRelationType.SharesConcept,
          rationale: "Both describe the same feedback loop.",
        },
      ],
    };

    expect(cardRelationSchema.parse(input)).toEqual(input);
    expect(() =>
      cardRelationSchema.parse({
        edges: [{ ...input.edges[0], cardIds: ["m1-card-2"] }],
      })
    ).toThrow();
  });
});
