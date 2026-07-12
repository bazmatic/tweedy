import {
  ISpeakerAgent,
  LlmMessage,
  PodcastScript,
  Speech,
  Speaker,
  StopReason,
} from "../types";
import { BaseAgent } from "./BaseAgent";
import { logger } from "../utils/logger";
import { RAGService } from "../rag";
import {
  INTERJECTION_TOOLS,
  SHORT_REACTION_TOOLS,
  SOLO_TOOLS,
  SpeakerAgentToolName,
  toLlmTools,
} from "./speaker-tools";

export class SpeakerAgent extends BaseAgent implements ISpeakerAgent {
  private static readonly SPEECH_MAX_TOKENS = 150;
  // Tight on purpose: interjections are meant to be very short words, and a shared
  // budget with SPEAK-length turns let the model ramble well past that.
  private static readonly INTERJECTION_MAX_TOKENS = 100;
  // A recap has to touch several points in one turn, so it needs more room
  // than a normal single-idea SPEAK turn, but stays well short of a ramble.
  private static readonly SUMMARY_MAX_TOKENS = 180;

  private speaker: Speaker;
  private ragService?: RAGService;
  private maxAttempts = 3;

  constructor(speaker: Speaker, ragService?: RAGService) {
    super();
    this.speaker = speaker;
    this.ragService = ragService;
  }

  async speak(
    script: PodcastScript,
    direction: string,
    timeStatus = "",
    forceNearlyOutOfTime = false,
    requestSummary = false
  ): Promise<Speech> {
    let attempts = 0;

    while (attempts < this.maxAttempts) {
      try {
        this.logAgentAction("Generating speech", {
          speaker: this.speaker.name,
          attempt: attempts + 1,
        });

        const { toolName, message, style, stopReason } =
          await this.generateSpeech(
            script,
            direction,
            timeStatus,
            forceNearlyOutOfTime,
            requestSummary
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
          stopReason,
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
        toLlmTools(INTERJECTION_TOOLS),
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
        stopReason: result.stopReason,
      };
    } catch (error) {
      logger.warn("Interjection generation failed:", error);
      return this.createFallbackSpeech();
    }
  }

  private async generateSpeech(
    script: PodcastScript,
    direction: string,
    timeStatus: string,
    forceNearlyOutOfTime: boolean,
    requestSummary: boolean
  ): Promise<{
    toolName: SpeakerAgentToolName;
    message: string;
    style: string;
    stopReason: StopReason;
  }> {
    const isSolo = script.speakers.length <= 1;
    const conversationHistory = this.getConversationHistory(script);
    const expertLevel = this.speaker.isExpert
      ? "Expert"
      : "General audience (no access to source material — you only know what's been discussed aloud or is common knowledge)";
    const materialsSection = this.speaker.isExpert
      ? `\n\nRelevant Materials:\n${await this.getRelevantMaterials(
          script,
          direction
        )}`
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

Director's guidance: ${direction}${
          timeStatus
            ? forceNearlyOutOfTime
              ? `\n\nTime status: ${timeStatus} You must use the nearly_out_of_time tool this turn to tell your co-hosts you're running low on time.`
              : `\n\nTime status: ${timeStatus} If it fits naturally, you can use the nearly_out_of_time tool to flag the time to your co-hosts.`
            : ""
        }

Respond naturally as ${
          this.speaker.name
        }. Choose the response style tool that best fits this moment in the conversation, and provide both the spoken message and a delivery style for it.${this.getBrevityNudge(
          script,
          isSolo
        )}${this.getExpertiseNudge(isSolo)} Get ONE idea out and then stop — a single point, fact, or beat per turn, not a multi-part explanation. Trust your co-host to ask a follow-up if they want more; don't pre-empt their next question by answering it yourself in the same turn. Be authentic to your personality and expertise level. Make the speech sound like real, unscripted talk, not a written passage: sprinkle in filler words (um, uh, er, like, you know), false starts and self-corrections ("it was — actually, no, it was..."), and the occasional stammer. Use ellipsis ("...") often to show trailing off, hesitation, or a pause before continuing a thought. Sometimes stop mid-sentence as if you've lost the word or the thread entirely — trail off with "..." and don't finish the thought; your co-host may jump in and finish it for you. Do not include stage directions, emotes, sound effects or physical actions in the message itself — those belong in the style argument.`,
      },
    ];

    const tools = forceNearlyOutOfTime
      ? toLlmTools([SpeakerAgentToolName.NEARLY_OUT_OF_TIME])
      : requestSummary
        ? toLlmTools([SpeakerAgentToolName.SUMMARIZE])
        : toLlmTools(isSolo ? SOLO_TOOLS : undefined);

    const maxTokens =
      requestSummary && !forceNearlyOutOfTime
        ? SpeakerAgent.SUMMARY_MAX_TOKENS
        : SpeakerAgent.SPEECH_MAX_TOKENS;

    const result = await this.callModelWithTools(messages, tools, maxTokens);

    return {
      toolName: result.toolName as SpeakerAgentToolName,
      message: result.message,
      style: result.style,
      stopReason: result.stopReason,
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
  private getBrevityNudge(script: PodcastScript, isSolo: boolean): string {
    let consecutiveLongTurns = 0;
    for (let i = script.speeches.length - 1; i >= 0; i--) {
      if (script.speeches[i].tool === SpeakerAgentToolName.SPEAK) {
        consecutiveLongTurns++;
      } else {
        break;
      }
    }

    if (consecutiveLongTurns >= 2) {
      const shortTools = isSolo
        ? [SpeakerAgentToolName.ONE_LINER]
        : SHORT_REACTION_TOOLS;
      return ` The conversation has had ${consecutiveLongTurns} long responses in a row — strongly prefer a short tool (${shortTools.join(
        ", "
      )}) this turn instead of another full explanation.`;
    }

    return "";
  }

  /**
   * Steers tool choice by expertise: experts have the material and should
   * carry the substantive explaining, non-experts are the audience surrogate
   * and should mostly react/question rather than hold forth.
   */
  private getExpertiseNudge(isSolo: boolean): string {
    if (this.speaker.isExpert) {
      return " As the expert here with access to the material, favor the speak tool to carry the substantive explanation — that's your role in this conversation.";
    }

    const shortTools = isSolo
      ? [SpeakerAgentToolName.ONE_LINER]
      : SHORT_REACTION_TOOLS;
    return ` As a non-expert, you rarely have new information to add — favor short tools (${shortTools.join(
      ", "
    )}) most turns, and reserve speak for the occasional genuine point.`;
  }

  private async getRelevantMaterials(
    script: PodcastScript,
    direction: string
  ): Promise<string> {
    if (this.ragService) {
      try {
        const docs = await this.ragService.searchRelevantContent(
          direction,
          3
        );
        if (docs.length > 0) {
          return docs
            .map(
              (doc) =>
                `${doc.metadata.title}: ${doc.content.substring(0, 200)}...`
            )
            .join("\n\n");
        }
      } catch (error) {
        logger.warn(
          "RAG material search failed, falling back to naive material selection:",
          error
        );
      }
    }

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
      instructions: "Natural, conversational tone",
      voice: this.speaker.voice,
      voiceStyle: this.speaker.voiceStyle,
      timestamp: new Date(),
    };
  }

  private generateId(): string {
    return Math.random().toString(36).substr(2, 9);
  }
}

