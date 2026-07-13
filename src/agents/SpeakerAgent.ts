import {
  ISpeakerAgent,
  EditorialCard,
  LlmMessage,
  PodcastScript,
  Speech,
  Speaker,
  StopReason,
  TurnBrief,
} from "../types";
import { BaseAgent } from "./BaseAgent";
import { logger } from "../utils/logger";
import { RAGService } from "../rag";
import {
  INTERJECTION_TOOLS,
  INTERVIEWER_TOOLS,
  SHORT_REACTION_TOOLS,
  SOLO_TOOLS,
  SpeakerAgentToolName,
  getToolMaxTokens,
  toLlmTools,
} from "./speaker-tools";

export class SpeakerAgent extends BaseAgent implements ISpeakerAgent {

  private speaker: Speaker;
  private ragService?: RAGService;
  private maxAttempts = 3;

  constructor(speaker: Speaker, ragService?: RAGService) {
    super();
    this.speaker = speaker;
    this.ragService = ragService;
  }

  async speak(
    speeches: Speech[],
    speakers: Speaker[],
    materials: PodcastScript['materials'],
    title: string,
    description: string,
    direction: string,
    timeStatus = "",
    forceNearlyOutOfTime = false,
    requestSummary = false,
    isFinalTurn = false,
    turnBrief?: TurnBrief,
    editorialCards: EditorialCard[] = []
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
            speeches,
            speakers,
            materials,
            title,
            description,
            direction,
            timeStatus,
            forceNearlyOutOfTime,
            requestSummary,
            isFinalTurn,
            turnBrief,
            editorialCards
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
          turnBrief,
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
  async interject(lastSpeech: Speech): Promise<Speech> {
    try {
      const messages: LlmMessage[] = [
        {
          role: "user" as const,
          content: `You are ${this.speaker.name}, a podcast speaker with the following characteristics:
- Personality: ${this.speaker.personality}
- Voice Style: ${this.speaker.voiceStyle}

${lastSpeech.speaker.name} just said: "${lastSpeech.message}"

Give a brief, natural reaction to cut in with — a quick interjection or filler comment. Do not summarise or explain, just react in the moment.`,
        },
      ];

      const result = await this.callModelWithTools(
        messages,
        toLlmTools(INTERJECTION_TOOLS),
        getToolMaxTokens(SpeakerAgentToolName.INTERJECT)
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
    speeches: Speech[],
    speakers: Speaker[],
    materials: PodcastScript['materials'],
    title: string,
    description: string,
    direction: string,
    timeStatus: string,
    forceNearlyOutOfTime: boolean,
    requestSummary: boolean,
    isFinalTurn: boolean,
    turnBrief?: TurnBrief,
    editorialCards: EditorialCard[] = []
  ): Promise<{
    toolName: SpeakerAgentToolName;
    message: string;
    style: string;
    stopReason: StopReason;
  }> {
    const isSolo = speakers.length <= 1;
    const conversationHistory = this.getConversationHistory(speeches);
    const expertLevel = this.speaker.isExpert
      ? "Expert"
      : "Audience guide (use only what has been discussed aloud, common knowledge, or the prepared editorial cards assigned to this turn; do not pretend to be a subject-matter expert)";
    const materialsSection = this.speaker.isExpert
      ? `\n\nRelevant Materials:\n${await this.getRelevantMaterials(
          materials,
          direction
        )}`
      : "";
    const editorialSection = this.getEditorialContext(
      turnBrief,
      editorialCards
    );

    const closingPromptAddendum = isFinalTurn
      ? "\n\nThis is the final turn of the episode. Use the closing_statement tool to deliver a warm, authentic closing that wraps up the podcast and signs off naturally."
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
- Title: ${title}
- Description: ${description}

Conversation History (speaker: message [tool used]):
${conversationHistory}${materialsSection}

Director's guidance: ${direction}${editorialSection}${
          timeStatus
            ? forceNearlyOutOfTime
              ? `\n\nTime status: ${timeStatus} You must use the nearly_out_of_time tool this turn to tell your co-hosts you're running low on time.`
              : `\n\nTime status: ${timeStatus} If it fits naturally, you can use the nearly_out_of_time tool to flag the time to your co-hosts.`
            : ""
        }${closingPromptAddendum}

Respond naturally as ${
          this.speaker.name
        }. Choose the response style tool that best fits this moment in the conversation, and provide both the spoken message and a delivery style for it.${this.getBrevityNudge(
          speeches,
          isSolo
        )}${this.getExpertiseNudge(isSolo, turnBrief)} **CRITICAL: Keep this to 1-2 sentences max (under 50 words).** Get ONE idea or conversational beat out and then stop. Serve the assigned audience value without forcing analysis, jokes or profundity where they do not belong. Trust your co-host to ask a follow-up; don't pre-empt their next question. Use Australian/British spelling. Be authentic to your personality and expertise level. Make the speech sound like real, unscripted talk with occasional filler words (um, uh, like, you know), false starts ("it was — actually, no..."), and occasional stammers, but do not overuse them. Use ellipsis ("...") to show trailing off or hesitation. Don't include stage directions, emotes, or sound effects — those belong in the style argument only.`,
      },
    ];

    const toolSet = isFinalTurn
      ? [SpeakerAgentToolName.CLOSING_STATEMENT]
      : forceNearlyOutOfTime
        ? [SpeakerAgentToolName.NEARLY_OUT_OF_TIME]
        : requestSummary
          ? [SpeakerAgentToolName.SUMMARIZE]
          : isSolo
            ? SOLO_TOOLS
            : this.speaker.isExpert
              ? undefined
              : INTERVIEWER_TOOLS;

    const tools = toLlmTools(toolSet);

    const maxTokens =
      isFinalTurn
        ? getToolMaxTokens(SpeakerAgentToolName.CLOSING_STATEMENT)
        : requestSummary && !forceNearlyOutOfTime
          ? getToolMaxTokens(SpeakerAgentToolName.SUMMARIZE)
          : getToolMaxTokens(SpeakerAgentToolName.SPEAK);

    const result = await this.callModelWithTools(messages, tools, maxTokens);

    return {
      toolName: result.toolName as SpeakerAgentToolName,
      message: result.message,
      style: result.style,
      stopReason: result.stopReason,
    };
  }

  private getConversationHistory(speeches: Speech[]): string {
    return speeches
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
  private getBrevityNudge(speeches: Speech[], isSolo: boolean): string {
    let consecutiveLongTurns = 0;
    for (let i = speeches.length - 1; i >= 0; i--) {
      if (speeches[i].tool === SpeakerAgentToolName.SPEAK) {
        consecutiveLongTurns++;
      } else {
        break;
      }
    }

    if (consecutiveLongTurns >= 1) {
      const shortTools = isSolo
        ? [SpeakerAgentToolName.ONE_LINER]
        : SHORT_REACTION_TOOLS;
      return ` **YOU MUST use a short tool this turn** (${shortTools.join(
        ", "
      )}) — no long explanations, just a brief reaction or quick point.`;
    }

    return "";
  }

  /**
   * Steers tool choice by expertise: experts have the material and should
   * carry the substantive explaining, non-experts are the audience surrogate
   * and should mostly react/question rather than hold forth.
   */
  private getExpertiseNudge(
    isSolo: boolean,
    turnBrief?: TurnBrief
  ): string {
    if (this.speaker.isExpert) {
      return " As the expert here with access to the material, use the speak tool to deliver substantive explanations — that's your role.";
    }

    if (isSolo) {
      return ` As the audience's guide, make the material accessible and engaging without claiming unsupported expertise.`;
    }
    return ` As the audience's guide, you may ask, react, challenge, reframe, illustrate or tell a prepared story. Use speak only when the assigned move (${turnBrief?.move ?? "the current move"}) calls for a substantive contribution, and never introduce unsupported facts.`;
  }

  private async getRelevantMaterials(
    materials: PodcastScript['materials'],
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

    return materials
      .slice(0, 3) // First 3 materials
      .map(
        (material) =>
          `${material.title}: ${material.content.substring(0, 200)}...`
      )
      .join("\n\n");
  }

  private getEditorialContext(
    brief: TurnBrief | undefined,
    cards: EditorialCard[]
  ): string {
    if (!brief) return "";
    const relevantCards = cards
      .filter((card) => brief.cardIds.includes(card.id))
      .map((card) => `- ${card.kind}: ${card.content}`)
      .join("\n");
    return `

Turn brief:
- Goal: ${brief.goal}
- Editorial move: ${brief.move}
- Primary audience value: ${brief.audienceValue}
- Desired energy: ${brief.desiredEnergy}${
      brief.device ? `\n- Optional conversational device: ${brief.device}` : ""
    }
Prepared editorial material for this turn:
${relevantCards || "(No specific editorial cards assigned.)"}`;
  }

  private createFallbackSpeech(): Speech {
    const fallbackMessages = [
      "Hmm...",
      "Ah ok.",
      "Huh.",
      "Wow.",
      "Oh...",
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
