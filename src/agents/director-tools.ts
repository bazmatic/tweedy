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
            "IDs of currently-open discussion points that the most recent speech(es) explicitly and substantively discussed with specific detail from the point's text — not merely a topically-adjacent mention. For example, if a point is \"CO2 scrubber duct-tape hack\" and the speech only mentions an oxygen tank explosion, that point is NOT covered. Omit or leave empty if none were covered.",
        },
      },
      required: ["speakerId", "direction"],
    },
  };
}

export interface VerifyCoveredPointsInput {
  confirmedPointIds: string[];
}

export const VERIFY_COVERED_POINTS_TOOL_NAME = "verify_covered_points";

export function toVerifyCoveredPointsTool(): LlmTool {
  return {
    name: VERIFY_COVERED_POINTS_TOOL_NAME,
    description:
      "Verify which candidate discussion points were actually, substantively covered by the recent speech text, strictly rejecting points that were only topically adjacent.",
    input_schema: {
      type: "object",
      properties: {
        confirmedPointIds: {
          type: "array",
          items: { type: "string" },
          description:
            "IDs of the candidate points that the recent speech text explicitly and substantively discussed with specific detail from the point's text. Exclude any point that was only topically adjacent or mentioned in passing without matching detail. For example, if a point is \"CO2 scrubber duct-tape hack\" and the speech only mentions an oxygen tank explosion, that point must be excluded.",
        },
      },
      required: ["confirmedPointIds"],
    },
  };
}

export interface CheckConversationCompleteInput {
  isComplete: boolean;
}

export const CHECK_CONVERSATION_COMPLETE_TOOL_NAME =
  "check_conversation_complete";

export function toCheckConversationCompleteTool(): LlmTool {
  return {
    name: CHECK_CONVERSATION_COMPLETE_TOOL_NAME,
    description:
      "Judge whether the conversation has reached a natural, satisfying conclusion (e.g. farewells exchanged, explicit sense of wrap-up) versus still being mid-thought even though all discussion points are covered.",
    input_schema: {
      type: "object",
      properties: {
        isComplete: {
          type: "boolean",
          description:
            "True only if the recent speech(es) show the conversation has genuinely wrapped up naturally — not merely that all discussion points are covered.",
        },
      },
      required: ["isComplete"],
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
        points: {
          type: "array",
          items: { type: "string" },
          description:
            "Concrete, discrete discussion points that must be covered during the episode, each a short phrase. The exact minimum count is given in the prompt, scaled to episode length. Provide this before the narrative.",
        },
        narrative: {
          type: "string",
          description:
            "A detailed prose description of how the conversation should flow: opening, segments, closing.",
        },
      },
      required: ["points", "narrative"],
    },
  };
}
