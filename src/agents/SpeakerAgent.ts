import {
  AudienceProfile,
  ISpeakerAgent,
  EditorialCard,
  EpistemicRole,
  LlmMessage,
  PodcastScript,
  Speech,
  Speaker,
  SourceAccess,
  StopReason,
  TerminologyLedger,
  TurnBrief,
} from "../types";
import { BaseAgent } from "./BaseAgent";
import { logger } from "../utils/logger";
import { RAGService } from "../rag";
import {
  INTERJECTION_TOOLS,
  SpeakerAgentToolName,
  getToolMaxTokens,
  toLlmTools,
} from "./speaker-tools";
import { NaturalSpeechStylePolicy } from "./NaturalSpeechStylePolicy";
import { SpeakerRoleProfileResolver } from "./SpeakerRoleProfileResolver";
import { ResponseModePolicy } from "./ResponseModePolicy";
import { AudienceAccessibilityPolicy } from "./AudienceAccessibilityPolicy";
import { ModelTask } from "../providers/ModelRoutingPolicy";

const EMPTY_TERMINOLOGY_LEDGER: TerminologyLedger = { explainedTerms: [] };

export class SpeakerAgent extends BaseAgent implements ISpeakerAgent {

  private speaker: Speaker;
  private ragService?: RAGService;
  private maxAttempts = 3;
  private readonly roleProfileResolver: SpeakerRoleProfileResolver;
  private readonly naturalSpeechStylePolicy: NaturalSpeechStylePolicy;
  private readonly responseModePolicy: ResponseModePolicy;
  private readonly audienceAccessibilityPolicy: AudienceAccessibilityPolicy;

  constructor(
    speaker: Speaker,
    ragService?: RAGService,
    roleProfileResolver = new SpeakerRoleProfileResolver(),
    naturalSpeechStylePolicy = new NaturalSpeechStylePolicy(),
    responseModePolicy = new ResponseModePolicy(roleProfileResolver),
    audienceAccessibilityPolicy = new AudienceAccessibilityPolicy()
  ) {
    super();
    this.speaker = speaker;
    this.ragService = ragService;
    this.roleProfileResolver = roleProfileResolver;
    this.naturalSpeechStylePolicy = naturalSpeechStylePolicy;
    this.responseModePolicy = responseModePolicy;
    this.audienceAccessibilityPolicy = audienceAccessibilityPolicy;
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
    editorialCards: EditorialCard[] = [],
    audienceProfile = AudienceProfile.General,
    terminologyLedger = EMPTY_TERMINOLOGY_LEDGER
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
            editorialCards,
            audienceProfile,
            terminologyLedger
          );

        const requiresCompleteDelivery =
          isFinalTurn || toolName === SpeakerAgentToolName.SUMMARIZE;
        if (requiresCompleteDelivery && stopReason === "max_tokens") {
          throw new Error(
            `${toolName} reached the token limit before it could finish`
          );
        }

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
          return this.createFallbackSpeech(isFinalTurn);
        }
      }
    }

    return this.createFallbackSpeech(isFinalTurn);
  }

  /**
   * A cheap, forced-short-form turn used to interrupt a co-host mid-flow.
   * Only reaction tools are offered so this can never turn into another monologue.
   */
  async interject(lastSpeech: Speech): Promise<Speech> {
    try {
      const roleProfile = this.roleProfileResolver.resolve(this.speaker);
      const roleGuidance =
        roleProfile.epistemicRole === EpistemicRole.Expert
          ? "React from an expert stance. Do not perform surprise or confusion about foundational subject matter; briefly acknowledge, clarify, or gently correct it instead."
          : "React as the audience's guide without introducing new specialist facts.";
      const messages: LlmMessage[] = [
        {
          role: "user" as const,
          content: `You are ${this.speaker.name}, a podcast speaker with the following characteristics:
- Personality: ${this.speaker.personality}
- Voice Style: ${this.speaker.voiceStyle}
- Epistemic Role: ${roleProfile.epistemicRole}

${lastSpeech.speaker.name} just said: "${lastSpeech.message}"

Give a brief, natural reaction to cut in with — a quick interjection or filler comment. Do not summarise or explain, just react in the moment. ${roleGuidance}`,
        },
      ];

      const result = await this.callModelWithTools(
        ModelTask.Interjection,
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
    editorialCards: EditorialCard[] = [],
    audienceProfile = AudienceProfile.General,
    terminologyLedger = EMPTY_TERMINOLOGY_LEDGER
  ): Promise<{
    toolName: SpeakerAgentToolName;
    message: string;
    style: string;
    stopReason: StopReason;
  }> {
    const isSolo = speakers.length <= 1;
    const conversationHistory = this.getConversationHistory(speeches);
    const roleProfile = this.roleProfileResolver.resolve(this.speaker);
    const materialsSection = roleProfile.sourceAccess === SourceAccess.Full
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
      ? `\n\nThis is the final turn of the episode. Use the closing_statement tool to deliver a warm, authentic closing that wraps up the podcast and signs off naturally. Name the episode exactly "${title}" if you name it at all. Do not invent a different programme name, release schedule or future episode details. Take enough time to complete the thought and finish the final sentence cleanly; do not trail off.`
      : "";
    const lengthGuidance = isFinalTurn
      ? "This closing is exempt from the normal 50-word turn limit. Let it breathe for a few natural sentences so the reflection, thanks, and sign-off all land without rushing."
      : "**CRITICAL: Keep this to 1-2 sentences max (under 50 words).** Get ONE idea or conversational beat out and then stop.";

    const messages: LlmMessage[] = [
      {
        role: "user" as const,
        content: `You are ${
          this.speaker.name
        }, a podcast speaker with the following characteristics:
- Personality: ${this.speaker.personality}
- Voice Style: ${this.speaker.voiceStyle}
- Epistemic Role: ${roleProfile.epistemicRole}
- Source Access: ${roleProfile.sourceAccess}
- Uncertainty Style: ${roleProfile.uncertaintyStyle}
- Audience Profile: ${audienceProfile}

Podcast Context:
- Title: ${title}
- Description: ${description}

Conversation History (speaker: message [tool used]):
${conversationHistory}${materialsSection}

Director's guidance: ${direction}${editorialSection}${
          timeStatus && !isFinalTurn
            ? forceNearlyOutOfTime
              ? `\n\nTime status: ${timeStatus} You must use the nearly_out_of_time tool this turn to tell your co-hosts you're running low on time.`
              : `\n\nTime status: ${timeStatus} If it fits naturally, you can use the nearly_out_of_time tool to flag the time to your co-hosts.`
            : ""
        }${closingPromptAddendum}

Respond naturally as ${
          this.speaker.name
        }. Choose the response style tool that best fits this moment in the conversation, and provide both the spoken message and a delivery style for it.${this.getExpertiseNudge(isSolo, roleProfile.epistemicRole, turnBrief)} ${this.audienceAccessibilityPolicy.buildSpeakerGuidance(audienceProfile, terminologyLedger)} ${lengthGuidance} Serve the assigned audience value without forcing analysis, jokes or profundity where they do not belong. Trust your co-host to ask a follow-up; don't pre-empt their next question. Use Australian/British spelling. Be authentic to your personality and epistemic role. ${this.naturalSpeechStylePolicy.buildGuidance(roleProfile)} Don't include stage directions, emotes, or sound effects — those belong in the style argument only.`,
      },
    ];

    const toolSet = this.responseModePolicy.selectTools({
      speaker: this.speaker,
      speeches,
      isSolo,
      isFinalTurn,
      forceNearlyOutOfTime,
      requestSummary,
      turnBrief,
    });

    const tools = toLlmTools(toolSet);

    const maxTokens =
      isFinalTurn
        ? getToolMaxTokens(SpeakerAgentToolName.CLOSING_STATEMENT)
        : requestSummary && !forceNearlyOutOfTime
          ? getToolMaxTokens(SpeakerAgentToolName.SUMMARIZE)
          : getToolMaxTokens(SpeakerAgentToolName.SPEAK);

    const result = await this.callModelWithTools(
      ModelTask.SpeechGeneration,
      messages,
      tools,
      maxTokens
    );

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
   * Steers tool choice by expertise: experts have the material and should
   * carry the substantive explaining, non-experts are the audience surrogate
   * and should mostly react/question rather than hold forth.
   */
  private getExpertiseNudge(
    isSolo: boolean,
    epistemicRole: EpistemicRole,
    turnBrief?: TurnBrief
  ): string {
    if (epistemicRole === EpistemicRole.Expert) {
      return " As the expert, answer from the material with appropriate confidence. Do not feign ignorance or perform surprise at foundational material you are responsible for explaining. Never react as though you have just discovered a source fact that you already know or have just explained; clarify its significance from an expert stance instead.";
    }

    if (epistemicRole === EpistemicRole.InformedHost) {
      return " As an informed host, introduce only prepared material explicitly assigned to this turn, and frame it as preparation rather than specialist authority.";
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

  private createFallbackSpeech(isFinalTurn = false): Speech {
    if (isFinalTurn) {
      return {
        id: this.generateId(),
        speaker: this.speaker,
        message:
          "That's where we'll leave it for today. Thanks for joining us, and thanks to everyone listening. Until next time.",
        instructions: "Warm, unhurried, natural sign-off",
        voice: this.speaker.voice,
        voiceStyle: this.speaker.voiceStyle,
        timestamp: new Date(),
        tool: SpeakerAgentToolName.CLOSING_STATEMENT,
        stopReason: "stop",
      };
    }

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
