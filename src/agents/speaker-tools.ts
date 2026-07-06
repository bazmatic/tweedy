import type { Tool } from "@anthropic-ai/sdk/resources/messages";

export enum SpeakerAgentToolName {
  SPEAK = "speak",
  INTERJECT = "interject",
  ONE_LINER = "one_liner",
  FILLER_COMMENT = "filler_comment",
  QUOTE = "quote",
  SHORT_QUESTION = "short_question",
  NEARLY_OUT_OF_TIME = "nearly_out_of_time",
}

export interface SpeakerToolDefinition {
  name: SpeakerAgentToolName;
  toolDescription: string;
  styleDescription: string;
}

export const SPEAKER_TOOL_DEFINITIONS: SpeakerToolDefinition[] = [
  {
    name: SpeakerAgentToolName.SPEAK,
    toolDescription:
      "Deliver a concise, natural-sounding response in the podcast. Keep your response very brief (1-2 sentences max) to maintain conversational flow. The message should be natural spoken language, while stage directions in instructions guide delivery. Use pauses and ums, like, ah, ..., etc.",
    styleDescription:
      "How to deliver the speech. Include timing, tone, and emphasis. Example: 'Pause slightly before speaking, use a thoughtful tone, emphasize \"perspective\"'",
  },
  {
    name: SpeakerAgentToolName.INTERJECT,
    toolDescription:
      "Make a brief, emotional reaction sound or very short response (maximum 1-10 words) to show engagement. Use for natural conversational responses like surprise, agreement, or interest. Keep it spontaneous and authentic.",
    styleDescription:
      "How to deliver the interjection. Include emotional context and delivery style. Example: 'Genuine surprise, slightly higher pitch, quick delivery'",
  },
  {
    name: SpeakerAgentToolName.ONE_LINER,
    toolDescription:
      "Deliver a witty, insightful, or thought-provoking single sentence that adds value to the conversation. Use for clever observations, gentle challenges, or memorable statements. Keep it concise and impactful.",
    styleDescription:
      "How to deliver the one-liner. Include timing, tone, and emphasis. Example: 'Pause slightly before speaking, use a thoughtful tone, emphasize \"perspective\"'",
  },
  {
    name: SpeakerAgentToolName.FILLER_COMMENT,
    toolDescription:
      "Use a very brief acknowledgment phrase of 1-3 words to show active listening and maintain conversation flow. Keep these responses minimal and natural, using common conversational fillers. Example: 'I see', 'Right', 'Got it', 'Makes sense', 'Interesting', etc.",
    styleDescription:
      "How to deliver the filler comment. Include timing, tone, and emphasis. Example: 'Pause slightly before speaking, use a thoughtful tone, emphasize \"perspective\"'",
  },
  {
    name: SpeakerAgentToolName.QUOTE,
    toolDescription:
      "Quote a small section of the material. Use for when you want to reference a specific section of the material. Example: 'It says here in the material we were given: \"...\"'. The quote should be no more than 20 words.",
    styleDescription:
      "How to deliver the quote. Include timing, tone, and emphasis. Example: 'Pause slightly before speaking, use a thoughtful tone, emphasize \"perspective\"'",
  },
  {
    name: SpeakerAgentToolName.SHORT_QUESTION,
    toolDescription:
      "Ask a focused, relevant question that advances the discussion. Keep questions concise and open-ended to encourage elaboration. Use for genuine curiosity or clarification. Use ums, like, etc.",
    styleDescription:
      "How to deliver the short question. Include timing, tone, and emphasis. Example: 'Pause slightly before speaking, use a thoughtful tone, emphasize \"perspective\"'",
  },
  {
    name: SpeakerAgentToolName.NEARLY_OUT_OF_TIME,
    toolDescription:
      "When the podcast is nearly over, let your co-hosts know that you're running out of time.",
    styleDescription:
      "How to deliver the nearly-out-of-time message. Include timing, tone, and emphasis. Example: 'Pause slightly before speaking, use a thoughtful tone, emphasize \"perspective\"'",
  },
];

export function toAnthropicTools(): Tool[] {
  return SPEAKER_TOOL_DEFINITIONS.map((definition) => ({
    name: definition.name,
    description: definition.toolDescription,
    input_schema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "The spoken text to deliver.",
        },
        style: {
          type: "string",
          description: definition.styleDescription,
        },
      },
      required: ["message", "style"],
    },
  }));
}
