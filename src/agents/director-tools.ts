import { LlmTool, Speaker } from "../types";

export const SELECT_NEXT_SPEAKER_TOOL_NAME = "select_next_speaker";
export const CREATE_PODCAST_PLAN_TOOL_NAME = "create_podcast_plan";

export interface SelectNextSpeakerInput {
  speakerId: string;
  direction: string;
  coveredPointIds?: string[];
}

export function toSelectNextSpeakerTool(speakers: Speaker[]): LlmTool {
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
        coveredPointIds: {
          type: "array",
          items: { type: "string" },
          description:
            "IDs of currently-open discussion points that the most recent speech(es) addressed. Omit or leave empty if none were covered.",
        },
      },
      required: ["speakerId", "direction"],
    },
  };
}

export interface CreatePodcastPlanInput {
  narrative: string;
  points: string[];
}

export function toCreatePodcastPlanTool(): LlmTool {
  return {
    name: CREATE_PODCAST_PLAN_TOOL_NAME,
    description:
      "Provide the podcast plan as a narrative description plus a list of discrete discussion points that must be covered.",
    input_schema: {
      type: "object",
      properties: {
        narrative: {
          type: "string",
          description:
            "A detailed prose description of how the conversation should flow: opening, segments, closing.",
        },
        points: {
          type: "array",
          items: { type: "string" },
          description:
            "3-8 concrete, discrete discussion points that must be covered during the episode, each a short phrase.",
        },
      },
      required: ["narrative", "points"],
    },
  };
}
