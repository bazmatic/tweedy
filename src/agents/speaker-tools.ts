import { LlmTool } from "../types";

export enum SpeakerAgentToolName {
  SPEAK = "speak",
  INTERJECT = "interject",
  ONE_LINER = "one_liner",
  FILLER_COMMENT = "filler_comment",
  QUOTE = "quote",
  SHORT_QUESTION = "short_question",
  NEARLY_OUT_OF_TIME = "nearly_out_of_time",
  CHALLENGE = "challenge",
  SUMMARIZE = "summarize",
  CLOSING_STATEMENT = "closing_statement",
}

export interface SpeakerToolDefinition {
  name: SpeakerAgentToolName;
  toolDescription: string;
  styleDescription: string;
  maxTokens: number;
}

export const SPEAKER_TOOL_DEFINITIONS: SpeakerToolDefinition[] = [
  {
    name: SpeakerAgentToolName.SPEAK,
    toolDescription:
      "Deliver a SHORT, concise, natural-sounding response in the podcast. Get ONE idea, fact, or beat out and then stop — 1-2 sentences max, never a multi-part explanation. Brevity is critical: shorter is always better than longer, and you should stop the moment the single idea has landed rather than padding it out. Keep it very brief to maintain conversational flow. The message should be natural spoken language, while stage directions in instructions guide delivery. Use pauses and ums, like, ah, ..., etc.",
    styleDescription:
      "How to deliver the speech. Include timing, tone, and emphasis. Example: 'Pause slightly before speaking, use a thoughtful tone, emphasize \"perspective\"'",
    maxTokens: 300,
  },
  {
    name: SpeakerAgentToolName.INTERJECT,
    toolDescription:
      "Make a brief, emotional reaction sound or very short response (maximum 1-10 words, never more). Use for natural conversational responses like surprise, agreement, or interest. Keep it spontaneous and authentic. Don't interrupt and then ramble — that would be rude, and this tool must never turn into a mini-speech. Example: 'Hang on, so it was a mistake?'",
    styleDescription:
      "How to deliver the interjection. Include emotional context and delivery style. Example: 'Genuine surprise, slightly higher pitch, quick delivery'",
    maxTokens: 100,
  },
  {
    name: SpeakerAgentToolName.ONE_LINER,
    toolDescription:
      "Deliver a witty, insightful, or thought-provoking single sentence — one sentence only, no more — that adds value to the conversation. Use for clever observations, gentle challenges, or memorable statements. Keep it concise and impactful. Example: 'So it's kind of the opposite!'",
    styleDescription:
      "How to deliver the one-liner. Include timing, tone, and emphasis. Example: 'Pause slightly before speaking, use a thoughtful tone, emphasize \"perspective\"'",
    maxTokens: 100,
  },
  {
    name: SpeakerAgentToolName.FILLER_COMMENT,
    toolDescription:
      "Use a very brief acknowledgment phrase of 1-3 words to show active listening and maintain conversation flow. Keep these responses minimal and natural, using common conversational fillers. Example: 'I see', 'Right', 'Got it', 'Makes sense', 'Interesting', etc.",
    styleDescription:
      "How to deliver the filler comment. Include timing, tone, and emphasis. Example: 'Pause slightly before speaking, use a thoughtful tone, emphasize \"perspective\"'",
    maxTokens: 100,
  },
  {
    name: SpeakerAgentToolName.QUOTE,
    toolDescription:
      "Quote a small section of the material. Use for when you want to reference a specific section of the material. Example: 'It says here in the material we were given: \"...\"'. The quote should be no more than 20 words.",
    styleDescription:
      "How to deliver the quote. Include timing, tone, and emphasis. Example: 'Pause slightly before speaking, use a thoughtful tone, emphasize \"perspective\"'",
    maxTokens: 200,
  },
  {
    name: SpeakerAgentToolName.SHORT_QUESTION,
    toolDescription:
      "Ask a focused, relevant question that advances the discussion, in one short sentence — no preamble or setup, just the question. Keep questions concise and open-ended to encourage elaboration. Use for genuine curiosity or clarification. Use ums, like, etc.",
    styleDescription:
      "How to deliver the short question. Include timing, tone, and emphasis. Example: 'Pause slightly before speaking, use a thoughtful tone, emphasize \"perspective\"'",
    maxTokens: 100,
  },
  {
    name: SpeakerAgentToolName.NEARLY_OUT_OF_TIME,
    toolDescription:
      "When the podcast is nearly over, let your co-hosts know that you're running out of time.",
    styleDescription:
      "How to deliver the nearly-out-of-time message. Include timing, tone, and emphasis. Example: 'Pause slightly before speaking, use a thoughtful tone, emphasize \"perspective\"'",
    maxTokens: 100,
  },
  {
    name: SpeakerAgentToolName.CHALLENGE,
    toolDescription:
      "Push back on what the previous speaker just said, in one short sentence — voice real doubt, skepticism, or outright disagreement. Use when you have a genuine reason to question their claim, not just to be contrarian. Distinct from ONE_LINER: this is about disputing a point, not making a clever observation.",
    styleDescription:
      "How you're pushing back. Include tone and delivery. Example: 'Skeptical, slightly incredulous, leaning into \"really?\"'",
    maxTokens: 100,
  },
  {
    name: SpeakerAgentToolName.SUMMARIZE,
    toolDescription:
      "Deliver a compact recap that briefly touches each of several named discussion points, one short clause per point, instead of one idea per turn. Use only when directed to catch up on multiple remaining points at once.",
    styleDescription:
      "How to deliver the summary. Include pacing and tone. Example: 'Brisk, matter-of-fact pace, quick transitions between points'",
    maxTokens: 120,
  },
  {
    name: SpeakerAgentToolName.CLOSING_STATEMENT,
    toolDescription:
      "Deliver a closing statement that wraps up the podcast. Briefly summarize key takeaways or themes, thank your co-host(s), and sign off naturally. Keep it warm and authentic to your personality — 2-3 sentences maximum. This is the final word of the episode.",
    styleDescription:
      "How to deliver the closing. Include tone and delivery style for signing off. Example: 'Warm, genuine, slightly reflective tone, natural pacing'",
    maxTokens: 120,
  },
];

export const SHORT_REACTION_TOOLS: SpeakerAgentToolName[] = [
  SpeakerAgentToolName.INTERJECT,
  SpeakerAgentToolName.FILLER_COMMENT,
  SpeakerAgentToolName.SHORT_QUESTION,
  SpeakerAgentToolName.ONE_LINER,
];

export const SOLO_TOOLS: SpeakerAgentToolName[] = [
  SpeakerAgentToolName.SPEAK,
  SpeakerAgentToolName.QUOTE,
  SpeakerAgentToolName.ONE_LINER,
];

export const INTERJECTION_TOOLS: SpeakerAgentToolName[] = [
  SpeakerAgentToolName.INTERJECT,
  SpeakerAgentToolName.FILLER_COMMENT,
  SpeakerAgentToolName.CHALLENGE,
];

/**
 * Audience guides can add value by reframing, illustrating or telling a
 * prepared story without pretending to be the subject-matter expert.
 */
export const INTERVIEWER_TOOLS: SpeakerAgentToolName[] = [
  SpeakerAgentToolName.SPEAK,
  SpeakerAgentToolName.INTERJECT,
  SpeakerAgentToolName.FILLER_COMMENT,
  SpeakerAgentToolName.SHORT_QUESTION,
  SpeakerAgentToolName.ONE_LINER,
  SpeakerAgentToolName.CHALLENGE,
];

export function getToolDefinition(name: SpeakerAgentToolName): SpeakerToolDefinition | undefined {
  return SPEAKER_TOOL_DEFINITIONS.find((def) => def.name === name);
}

export function getToolMaxTokens(name: SpeakerAgentToolName): number {
  return getToolDefinition(name)?.maxTokens ?? 200;
}

export function toLlmTools(only?: SpeakerAgentToolName[]): LlmTool[] {
  const definitions = only
    ? SPEAKER_TOOL_DEFINITIONS.filter((definition) =>
        only.includes(definition.name)
      )
    : SPEAKER_TOOL_DEFINITIONS;

  return definitions.map((definition) => ({
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
