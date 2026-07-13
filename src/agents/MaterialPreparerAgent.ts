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
  toPrepareMaterialTool,
} from "./editorial-tools";

const MAX_PREPARATION_TOKENS = 1800;
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

The podcast should help listeners understand the subject and enjoy the conversation. Insight is valuable, but this is not an analysis or science application. Extract 6-12 varied editorial cards appropriate to this particular material: essential points, background, clear explanations, examples, stories, characters, quotes, vivid details, surprises, humour opportunities, tensions, different perspectives, connections, takeaways and open questions.

Do not force every card kind. Prefer concrete, memorable and useful material. Keep factual cards faithful to the source, attach short supporting excerpts, and distinguish the source's claims from possible editorial questions. Use Australian/British spelling.

Title: ${material.title}

${material.content}`,
      },
    ];

    try {
      const result =
        await this.callModelForToolInput<PrepareMaterialInput>(
          messages,
          [toPrepareMaterialTool()],
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
      evidence: (card.excerpts ?? []).map((excerpt) => ({
        materialId: material.id,
        excerpt,
      })),
      relatedCardIds: [],
      tags: card.tags ?? [],
    }));

    return {
      materialId: material.id,
      synopsis: input.synopsis ?? "",
      cards,
    };
  }

  private createFallback(material: PodcastMaterial): PreparedMaterial {
    const excerpt = material.content.substring(0, FALLBACK_CONTENT_LENGTH);
    return {
      materialId: material.id,
      synopsis: excerpt,
      cards: [
        {
          id: `${material.id}-card-1`,
          materialId: material.id,
          kind: EditorialCardKind.EssentialPoint,
          content: excerpt,
          evidence: [{ materialId: material.id, excerpt }],
          relatedCardIds: [],
          tags: [],
        },
      ],
    };
  }
}
