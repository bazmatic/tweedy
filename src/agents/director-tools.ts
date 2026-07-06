import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { Speaker } from "../types";

export const SELECT_NEXT_SPEAKER_TOOL_NAME = "select_next_speaker";

export interface SelectNextSpeakerInput {
  speakerId: string;
  direction: string;
}

export function toSelectNextSpeakerTool(speakers: Speaker[]): Tool {
  return {
    name: SELECT_NEXT_SPEAKER_TOOL_NAME,
    description:
      "Choose which speaker should talk next and give them direction for their turn.",
    input_schema: {
      type: "object",
      properties: {
        speakerId: {
          type: "string",
          enum: speakers.map((speaker) => speaker.id),
          description: "The id of the speaker who should talk next.",
        },
        direction: {
          type: "string",
          description:
            "Clear, specific, conversational direction for what this speaker should say next.",
        },
      },
      required: ["speakerId", "direction"],
    },
  };
}
