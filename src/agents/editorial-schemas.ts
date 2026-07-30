import { z } from "zod";
import { EditorialCardKind } from "../types";

export const preparedCardSchema = z.object({
  kind: z
    .nativeEnum(EditorialCardKind)
    .describe("The editorial purpose served by this source-supported card."),
  content: z.string().describe("The reusable editorial ingredient."),
  significance: z
    .string()
    .describe(
      "Why this matters — the discussion angle a speaker can use to make it worth talking about, not just a fact to state. E.g. what it implies, challenges, connects to, or why a listener should care."
    ),
  excerpts: z
    .array(z.string())
    .describe(
      "Short source excerpts supporting this card; empty only for an explicitly open question or humour opportunity."
    ),
  tags: z
    .array(z.string())
    .optional()
    .describe("Optional subject-neutral retrieval tags."),
  keyTerms: z
    .array(z.string())
    .optional()
    .describe(
      "Technical or jargon terms a listener would need explained if this card were spoken aloud. Empty if the card introduces no new terminology."
    ),
  storyValue: z
    .number()
    .int()
    .min(1)
    .max(10)
    .describe(
      "How surprising, vivid, or emotionally engaging this card would sound spoken aloud to a general listener (1-10). Not a measure of factual importance — a true-but-flat fact scores low even if essential."
    ),
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

const singleItemArraySchema = (description: string) =>
  z.preprocess(
    (value) =>
      typeof value === "string"
        ? value.trim().length > 0
          ? [value]
          : []
        : value,
    z.array(z.string()).max(1).describe(description)
  );

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
    castConsistent: z
      .boolean()
      .describe(
        "False if the speech addresses, thanks, or refers to a named person by name who is not one of the episode's actual speakers."
      ),
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
    feedback: singleItemArraySchema(
      "One short, plain-language reason fragment when rejected; empty when accepted. Use at most 12 words, with no quotations or detailed rewrite."
    ),
  })
  .describe("An editorial and role-consistency review of one podcast turn.");

export type ReviewTurnInput = z.infer<typeof reviewTurnSchema>;

export const rewriteRejectedTurnSchema = z
  .object({
    message: z
      .string()
      .min(1)
      .describe(
        "The complete corrected spoken turn as one unbroken line. Natural dialogue only; no analysis, labels, markdown, citations, or bookkeeping."
      ),
  })
  .describe("A corrected replacement for a rejected podcast turn.");

export type RewriteRejectedTurnInput = z.infer<
  typeof rewriteRejectedTurnSchema
>;

export const episodeAuditSchema = z
  .object({
    issues: z
      .array(
        z.object({
          speechId: z.string(),
          category: z.enum([
            "listener_context",
            "dependency_order",
            "substantial_repetition",
            "speaker_role",
            "continuity",
            "closing_accuracy",
            "duration_language",
            "malformed_speech",
          ]),
          reason: z
            .string()
            .describe(
              "A plain-language reason fragment of at most 12 words, with no quotation."
            ),
        })
      )
      .max(3),
  })
  .describe(
    "At most three localised, repairable defects in a completed spoken episode."
  );

export type EpisodeAuditInput = z.infer<typeof episodeAuditSchema>;
export type EpisodeAuditIssue = EpisodeAuditInput["issues"][number] & {
  id: string;
};

export const condenseSpeechSchema = z
  .object({
    message: z
      .string()
      .describe(
        "The shortened spoken line: natural conversational dialogue that preserves the original's core meaning and voice, ends on a complete thought, and fits within the given word budget."
      ),
  })
  .describe(
    "A condensed rewrite of an overlong podcast line, fit to a hard word budget."
  );

export type CondenseSpeechInput = z.infer<typeof condenseSpeechSchema>;
