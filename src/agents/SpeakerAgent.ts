import {
  ISpeakerAgent,
  LlmMessage,
  PodcastScript,
  Speech,
  Speaker,
} from "../types";
import { BaseAgent } from "./BaseAgent";
import { logger } from "../utils/logger";
import {
  SHORT_REACTION_TOOLS,
  SpeakerAgentToolName,
  toLlmTools,
} from "./speaker-tools";

export class SpeakerAgent extends BaseAgent implements ISpeakerAgent {
  private static readonly SPEECH_MAX_TOKENS = 80;
  private static readonly INTERJECTION_MAX_TOKENS = 80;

  private speaker: Speaker;
  private maxAttempts = 3;

  constructor(speaker: Speaker) {
    super();
    this.speaker = speaker;
  }

  async speak(script: PodcastScript, direction: string): Promise<Speech> {
    let attempts = 0;

    while (attempts < this.maxAttempts) {
      try {
        this.logAgentAction("Generating speech", {
          speaker: this.speaker.name,
          attempt: attempts + 1,
        });

        const { toolName, message, style } = await this.generateSpeech(
          script,
          direction
        );

        const speech: Speech = {
          id: this.generateId(),
          speaker: this.speaker,
          message,
          instructions: style,
          voice: this.speaker.voice,
          voiceStyle: this.speaker.voiceStyle,
          timestamp: new Date(),
          tool: toolName,
        };

        logger.info(
          `Speech generated for ${this.speaker.name} (${toolName}): ${message.substring(
            0,
            100
          )}...`
        );
        return speech;
      } catch (error) {
        attempts++;
        logger.warn(`Speech generation attempt ${attempts} failed:`, error);

        if (attempts >= this.maxAttempts) {
          return this.createFallbackSpeech();
        }
      }
    }

    return this.createFallbackSpeech();
  }

  /**
   * A cheap, forced-short-form turn used to interrupt a co-host mid-flow.
   * Only reaction tools are offered so this can never turn into another monologue.
   */
  async interject(script: PodcastScript): Promise<Speech> {
    try {
      const lastSpeech = script.speeches[script.speeches.length - 1];

      const messages: LlmMessage[] = [
        {
          role: "user" as const,
          content: `You are ${this.speaker.name}, a podcast speaker with the following characteristics:
- Personality: ${this.speaker.personality}
- Voice Style: ${this.speaker.voiceStyle}

${lastSpeech.speaker.name} just said: "${lastSpeech.message}"

Give a brief, natural reaction to cut in with — a quick interjection or filler comment. If ${lastSpeech.speaker.name}'s line trails off or stops mid-sentence (e.g. ends with "..." or an unfinished thought), you can jump in and complete their sentence for them instead of just reacting. Do not summarize or explain, just react in the moment.`,
        },
      ];

      const result = await this.callModelWithTools(
        messages,
        toLlmTools(SHORT_REACTION_TOOLS.slice(0, 2)),
        SpeakerAgent.INTERJECTION_MAX_TOKENS
      );

      return {
        id: this.generateId(),
        speaker: this.speaker,
        message: result.message,
        instructions: result.style,
        voice: this.speaker.voice,
        voiceStyle: this.speaker.voiceStyle,
        timestamp: new Date(),
        tool: result.toolName as SpeakerAgentToolName,
      };
    } catch (error) {
      logger.warn("Interjection generation failed:", error);
      return this.createFallbackSpeech();
    }
  }

  private async generateSpeech(
    script: PodcastScript,
    direction: string
  ): Promise<{ toolName: SpeakerAgentToolName; message: string; style: string }> {
    const conversationHistory = this.getConversationHistory(script);
    const expertLevel = this.speaker.isExpert
      ? "Expert"
      : "General audience (no access to source material — you only know what's been discussed aloud or is common knowledge)";
    const materialsSection = this.speaker.isExpert
      ? `\n\nRelevant Materials:\n${this.getRelevantMaterials(script)}`
      : "";

    const messages: LlmMessage[] = [
      {
        role: "user" as const,
        content: `You are ${
          this.speaker.name
        }, a podcast speaker with the following characteristics:
- Personality: ${this.speaker.personality}
- Voice Style: ${this.speaker.voiceStyle}
- Expert Level: ${expertLevel}

Podcast Context:
- Title: ${script.title}
- Description: ${script.description}

Conversation History (speaker: message [tool used]):
${conversationHistory}${materialsSection}

Director's guidance: ${direction}

Respond naturally as ${
          this.speaker.name
        }. Choose the response style tool that best fits this moment in the conversation, and provide both the spoken message and a delivery style for it.${this.getBrevityNudge(
          script
        )} Get ONE idea out and then stop — a single point, fact, or beat per turn, not a multi-part explanation. Trust your co-host to ask a follow-up if they want more; don't pre-empt their next question by answering it yourself in the same turn. Be authentic to your personality and expertise level. Make the speech sound like real, unscripted talk, not a written passage: sprinkle in filler words (um, uh, er, like, you know), false starts and self-corrections ("it was — actually, no, it was..."), and the occasional stammer. Use ellipsis ("...") often to show trailing off, hesitation, or a pause before continuing a thought. Sometimes stop mid-sentence as if you've lost the word or the thread entirely — trail off with "..." and don't finish the thought; your co-host may jump in and finish it for you. Do not include stage directions, emotes, sound effects or physical actions in the message itself — those belong in the style argument.`,
      },
    ];

    const result = await this.callModelWithTools(
      messages,
      toLlmTools(),
      SpeakerAgent.SPEECH_MAX_TOKENS
    );

    return {
      toolName: result.toolName as SpeakerAgentToolName,
      message: result.message,
      style: result.style,
    };
  }

  private getConversationHistory(script: PodcastScript): string {
    return script.speeches
      .slice(-10) // Last 10 speeches
      .map(
        (speech) =>
          `${speech.speaker.name}: ${speech.message} [${
            speech.tool ?? "unknown"
          }]`
      )
      .join("\n");
  }

  /**
   * Counts consecutive trailing speeches that used a long-form tool (SPEAK),
   * so the prompt can push back toward short reactions after a run of them.
   */
  private getBrevityNudge(script: PodcastScript): string {
    let consecutiveLongTurns = 0;
    for (let i = script.speeches.length - 1; i >= 0; i--) {
      if (script.speeches[i].tool === SpeakerAgentToolName.SPEAK) {
        consecutiveLongTurns++;
      } else {
        break;
      }
    }

    if (consecutiveLongTurns >= 2) {
      return ` The conversation has had ${consecutiveLongTurns} long responses in a row — strongly prefer a short tool (${SHORT_REACTION_TOOLS.join(
        ", "
      )}) this turn instead of another full explanation.`;
    }

    return "";
  }

  private getRelevantMaterials(script: PodcastScript): string {
    return script.materials
      .slice(0, 3) // First 3 materials
      .map(
        (material) =>
          `${material.title}: ${material.content.substring(0, 200)}...`
      )
      .join("\n\n");
  }

  private createFallbackSpeech(): Speech {
    const fallbackMessages = [
      "That's an interesting point. Could you tell me more about that?",
      "I see what you mean. What do you think about the implications?",
      "That's a great question. Let me think about that for a moment.",
      "I'm not sure I fully understand. Could you elaborate?",
      "That reminds me of something similar I heard about.",
    ];

    const randomMessage =
      fallbackMessages[Math.floor(Math.random() * fallbackMessages.length)];

    return {
      id: this.generateId(),
      speaker: this.speaker,
      message: randomMessage,
      instructions: "Fallback response due to generation failure",
      voice: this.speaker.voice,
      voiceStyle: this.speaker.voiceStyle,
      timestamp: new Date(),
    };
  }

  private generateId(): string {
    return Math.random().toString(36).substr(2, 9);
  }
}

