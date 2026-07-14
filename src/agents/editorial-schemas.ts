import { z } from "zod";
import { EditorialCardKind } from "../types";

export const preparedCardSchema = z.object({
  kind: z
    .nativeEnum(EditorialCardKind)
    .describe("The editorial purpose served by this source-supported card."),
  content: z.string().describe("The reusable editorial ingredient."),
  excerpts: z
    .array(z.string())
    .describe(
      "Short source excerpts supporting this card; empty only for an explicitly open question or humour opportunity."
    ),
  tags: z
    .array(z.string())
    .optional()
    .describe("Optional subject-neutral retrieval tags."),
});

export type PreparedCardInput = z.infer<typeof preparedCardSchema>;

export const prepareMaterialSchema = z
  .object({
    synopsis: z
      .string()
      .describe(
        "A concise, podcast-ready synopsis using Australian/British spelling."
      ),
    cards: z
      .array(preparedCardSchema)
      .describe(
        "Useful, varied and source-supported editorial ingredients for the episode."
      ),
  })
  .describe("Prepared source material for podcast production.");

export type PrepareMaterialInput = z.infer<typeof prepareMaterialSchema>;

const introducedTermSchema = z.object({
  term: z.string().describe("The necessary technical term explained aloud."),
  plainLanguageMeaning: z
    .string()
    .describe("The plain-language meaning given to the listener."),
});

export const reviewTurnSchema = z
  .object({
    accepted: z.boolean(),
    clear: z.boolean(),
    engaging: z.boolean(),
    grounded: z.boolean(),
    advancesBeat: z.boolean(),
    addsVariety: z.boolean(),
    roleConsistent: z.boolean(),
    knowledgeConsistent: z.boolean(),
    audienceAccessible: z.boolean(),
    introducedCardIds: z
      .array(z.string())
      .describe(
        "Assigned card ids whose substance was explicitly introduced aloud."
      ),
    introducedTerms: z
      .array(introducedTermSchema)
      .describe(
        "Necessary technical terms first explained in this speech. Exclude incidental names and terms explained earlier."
      ),
    feedback: z
      .array(z.string())
      .max(1)
      .describe(
        "Focused revision guidance: empty when accepted, otherwise exactly one item."
      ),
    revisedMessages: z
      .array(z.string())
      .max(1)
      .describe(
        "Complete corrected speech: empty when accepted, otherwise exactly one item."
      ),
  })
  .describe("An editorial and role-consistency review of one podcast turn.");

export type ReviewTurnInput = z.infer<typeof reviewTurnSchema>;
