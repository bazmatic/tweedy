import { Agent } from "@mastra/core/agent";

/**
 * Studio-visible counterpart to src/agents/SpeakerAgent.ts. The real
 * pipeline (ScriptService) uses the LangChain-based SpeakerAgent class
 * directly, which is forced to pick a speaker-tools.ts tool per turn; this
 * Mastra Agent exists so a speaker's voice and prompting style can be
 * inspected and test-driven from the Studio Agents tab.
 */
export const speakerMastraAgent = new Agent({
  id: "speaker-agent",
  name: "Speaker Agent",
  instructions: `You are a podcast speaker. Given the conversation so far, prepared source material, and the director's brief direction for this turn, respond in character.

Stay authentic to your assigned personality, voice style, and epistemic role (expert, informed host, or audience guide). Keep turns short (1-2 sentences) unless the moment calls for substantive explanation. Never address yourself by your own name. Use Australian/British spelling, and write plain spoken text only — no stage directions, emotes, or markdown emphasis.`,
  model: "anthropic/claude-sonnet-4-5",
});
