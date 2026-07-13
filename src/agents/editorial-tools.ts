import {
  AudienceValue,
  BeatPurpose,
  EditorialCardKind,
  EditorialMove,
  EnergyLevel,
  LlmTool,
} from "../types";

export const PREPARE_MATERIAL_TOOL_NAME = "prepare_material";

export interface PreparedCardInput {
  kind: EditorialCardKind;
  content: string;
  excerpts: string[];
  tags?: string[];
}

export interface PrepareMaterialInput {
  synopsis: string;
  cards: PreparedCardInput[];
}

export function toPrepareMaterialTool(): LlmTool {
  return {
    name: PREPARE_MATERIAL_TOOL_NAME,
    description:
      "Prepare source material as a concise synopsis and a varied set of reusable editorial ingredients for a podcast.",
    input_schema: {
      type: "object",
      properties: {
        synopsis: {
          type: "string",
          description:
            "A concise, podcast-ready synopsis using Australian/British spelling.",
        },
        cards: {
          type: "array",
          description:
            "Subject-neutral editorial ingredients. Include only useful, source-supported cards and vary their kinds.",
          items: {
            type: "object",
            properties: {
              kind: {
                type: "string",
                enum: Object.values(EditorialCardKind),
              },
              content: { type: "string" },
              excerpts: {
                type: "array",
                items: { type: "string" },
                description:
                  "Short source excerpts supporting this card; empty only for an explicitly open question or humour opportunity.",
              },
              tags: { type: "array", items: { type: "string" } },
            },
            required: ["kind", "content", "excerpts"],
          },
        },
      },
      required: ["synopsis", "cards"],
    },
  };
}

export interface ConversationBeatInput {
  purpose: BeatPurpose;
  goal: string;
  cardIds?: string[];
  prerequisiteBeatIds?: string[];
  desiredEnergy?: EnergyLevel;
  targetTurns?: number;
}

export const REVIEW_TURN_TOOL_NAME = "review_turn";

export interface ReviewTurnInput {
  accepted: boolean;
  clear: boolean;
  engaging: boolean;
  grounded: boolean;
  advancesBeat: boolean;
  addsVariety: boolean;
  roleConsistent: boolean;
  knowledgeConsistent: boolean;
  introducedCardIds: string[];
  feedback?: string;
  revisedMessage?: string;
}

export function toReviewTurnTool(): LlmTool {
  return {
    name: REVIEW_TURN_TOOL_NAME,
    description:
      "Review a podcast turn against its particular editorial purpose, without requiring every turn to be analytical, funny or profound.",
    input_schema: {
      type: "object",
      properties: {
        accepted: { type: "boolean" },
        clear: { type: "boolean" },
        engaging: { type: "boolean" },
        grounded: { type: "boolean" },
        advancesBeat: { type: "boolean" },
        addsVariety: { type: "boolean" },
        roleConsistent: { type: "boolean" },
        knowledgeConsistent: { type: "boolean" },
        introducedCardIds: {
          type: "array",
          items: { type: "string" },
          description:
            "Assigned prepared card ids whose substance was explicitly introduced aloud in this turn. Exclude cards merely available in the brief.",
        },
        feedback: {
          type: "string",
          description: "Focused revision guidance when the turn is rejected.",
        },
        revisedMessage: {
          type: "string",
          description:
            "A corrected version in the same voice when the turn is rejected.",
        },
      },
      required: [
        "accepted",
        "clear",
        "engaging",
        "grounded",
        "advancesBeat",
        "addsVariety",
        "roleConsistent",
        "knowledgeConsistent",
        "introducedCardIds",
      ],
    },
  };
}

export const EDITORIAL_MOVE_VALUES = Object.values(EditorialMove);
export const AUDIENCE_VALUE_VALUES = Object.values(AudienceValue);
export const ENERGY_LEVEL_VALUES = Object.values(EnergyLevel);
