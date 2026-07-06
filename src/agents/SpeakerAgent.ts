import Anthropic from "@anthropic-ai/sdk";
import { ISpeakerAgent, PodcastScript, Speech, Speaker } from "../types";
import { BaseAgent } from "./BaseAgent";
import { logger } from "../utils/logger";
import {
  SHORT_REACTION_TOOLS,
  SpeakerAgentToolName,
  toAnthropicTools,
} from "./speaker-tools";

export class SpeakerAgent extends BaseAgent implements ISpeakerAgent {
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

      const messages: Anthropic.MessageParam[] = [
        {
          role: "user" as const,
          content: `You are ${this.speaker.name}, a podcast speaker with the following characteristics:
- Personality: ${this.speaker.personality}
- Voice Style: ${this.speaker.voiceStyle}

${lastSpeech.speaker.name} just said: "${lastSpeech.message}"

Give a brief, natural reaction to cut in with — a quick interjection or filler comment. Do not summarize or explain, just react in the moment.`,
        },
      ];

      const result = await this.callClaudeWithTools(
        messages,
        toAnthropicTools(SHORT_REACTION_TOOLS.slice(0, 2)),
        80
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
    const relevantMaterials = this.getRelevantMaterials(script);

    const messages: Anthropic.MessageParam[] = [
      {
        role: "user" as const,
        content: `You are ${
          this.speaker.name
        }, a podcast speaker with the following characteristics:
- Personality: ${this.speaker.personality}
- Voice Style: ${this.speaker.voiceStyle}
- Expert Level: ${this.speaker.isExpert ? "Expert" : "General audience"}

Podcast Context:
- Title: ${script.title}
- Description: ${script.description}

Conversation History (speaker: message [tool used]):
${conversationHistory}

Relevant Materials:
${relevantMaterials}

Director's guidance: ${direction}

Respond naturally as ${
          this.speaker.name
        }. Choose the response style tool that best fits this moment in the conversation, and provide both the spoken message and a delivery style for it.${this.getBrevityNudge(
          script
        )} Be authentic to your personality and expertise level. Do not include stage directions, emotes, sound effects or physical actions in the message itself — those belong in the style argument.`,
      },
    ];

    const result = await this.callClaudeWithTools(
      messages,
      toAnthropicTools(),
      300
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

