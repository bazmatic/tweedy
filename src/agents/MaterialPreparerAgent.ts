import {
  EditorialCard,
  EditorialCardKind,
  IMaterialPreparer,
  LlmMessage,
  PodcastMaterial,
  PreparedMaterial,
} from "../types";
import { logger } from "../utils/logger";
import { BaseAgent } from "./BaseAgent";
import {
  PrepareMaterialInput,
  prepareMaterialSchema,
} from "./editorial-schemas";
import { ModelTask } from "../providers/ModelRoutingPolicy";

const MAX_PREPARATION_TOKENS = 3000;
const FALLBACK_CONTENT_LENGTH = 700;

export class MaterialPreparerAgent
  extends BaseAgent
  implements IMaterialPreparer
{
  async prepare(
    material: PodcastMaterial,
    context: { title: string; description: string }
  ): Promise<PreparedMaterial> {
    const messages: LlmMessage[] = [
      {
        role: "user",
        content: `Prepare this source for a podcast titled "${context.title}": ${context.description}.

The podcast should help listeners understand the subject and enjoy the conversation. Insight is valuable, but this is not an analysis or science application. Extract 6-12 varied editorial cards appropriate to this particular material: essential points, background, clear explanations, examples, stories, characters, quotes, vivid details, surprises, humour opportunities, tensions, different perspectives, connections, takeaways, open questions and big-picture framings.

Do not force every card kind, but if the material genuinely supports it, include exactly one big_picture card: a zoomed-out, mind-bending framing that hints at some larger mystery or wonder the subject connects to — the kind of idea that makes a listener go quiet for a second. It must still be grounded in the source, not invented awe.

Prefer concrete, memorable and useful material. Keep factual cards faithful to the source, attach short supporting excerpts, and distinguish the source's claims from possible editorial questions. For each card, list any technical or jargon terms in keyTerms that a general listener would need explained before the card's content could be spoken aloud — leave it empty for cards that introduce no new terminology. Use Australian/British spelling.

For every card, also give its significance: the discussion angle that makes it worth talking about, not just stating aloud. What does it imply, challenge, connect to, or why should a listener care? A card is a discussion point, not a fact to recite.

Score every card's storyValue from 1-10: how surprising, vivid or emotionally engaging it would sound spoken aloud to a general listener — not how factually important it is. 9-10 is a hook worth repeating at a party; 4-5 is true but flat; 1-3 is a raw data point. If the source material itself contains a curated section of highlights, fun facts, or podcast-friendly angles, treat its contents as a strong prior for 8-10 scores — a raw statistic from a methods or results section should not outscore a hook the source has already flagged as compelling.

Title: ${material.title}

${material.content}`,
      },
    ];

    try {
      const result =
        await this.callModelForStructuredOutput<PrepareMaterialInput>(
          ModelTask.MaterialPreparation,
          messages,
          prepareMaterialSchema,
          MAX_PREPARATION_TOKENS
        );
      return this.toPreparedMaterial(material, result);
    } catch (error) {
      logger.warn(
        `Failed to prepare material "${material.title}"; using a basic editorial card:`,
        error
      );
      return this.createFallback(material);
    }
  }

  private toPreparedMaterial(
    material: PodcastMaterial,
    input: PrepareMaterialInput
  ): PreparedMaterial {
    const cards: EditorialCard[] = (input.cards ?? []).map((card, index) => ({
      id: `${material.id}-card-${index + 1}`,
      materialId: material.id,
      kind: Object.values(EditorialCardKind).includes(card.kind)
        ? card.kind
        : EditorialCardKind.EssentialPoint,
      content: card.content,
      significance: card.significance,
      evidence: (card.excerpts ?? []).map((excerpt) => ({
        materialId: material.id,
        excerpt,
      })),
      relatedCardIds: [],
      tags: card.tags ?? [],
      keyTerms: card.keyTerms ?? [],
      storyValue: card.storyValue,
    }));

    for (const card of cards) {
      logger.info(
        `Prepared card ${card.id} [${card.kind}, storyValue=${card.storyValue}]: ${card.content}`
      );
    }

    return {
      materialId: material.id,
      synopsis: input.synopsis ?? "",
      cards,
    };
  }

  private createFallback(material: PodcastMaterial): PreparedMaterial {
    const excerpt = material.content.substring(0, FALLBACK_CONTENT_LENGTH);
    const card: EditorialCard = {
      id: `${material.id}-card-1`,
      materialId: material.id,
      kind: EditorialCardKind.EssentialPoint,
      content: excerpt,
      significance: "",
      evidence: [{ materialId: material.id, excerpt }],
      relatedCardIds: [],
      tags: [],
      keyTerms: [],
      storyValue: 5,
    };
    logger.info(
      `Prepared card ${card.id} [${card.kind}, storyValue=${card.storyValue}] (fallback): ${card.content}`
    );
    return {
      materialId: material.id,
      synopsis: excerpt,
      cards: [card],
    };
  }
}
