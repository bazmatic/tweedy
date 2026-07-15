import { describe, expect, it } from "vitest";
import { EditorialCardKind } from "../types";
import {
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
      introducedCardIds: [],
      introducedTerms: [
        { term: "hypha", plainLanguageMeaning: "a fungal thread" },
      ],
      feedback: [],
      revisedMessages: [],
    };

    expect(reviewTurnSchema.parse(review)).toEqual(review);
    expect(() => reviewTurnSchema.parse({ accepted: true })).toThrow();
  });
});
