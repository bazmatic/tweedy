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

  private mannerismsLine(): string {
    return this.speaker.mannerisms
      ? `\n- Mannerisms (draw on these for filler comments/interjections, don't overuse): ${this.speaker.mannerisms}`
      : "";
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
    forceColdOpen = false,
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
            forceColdOpen,
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
          ? "React from an expert stance. Do not perform surprise or confusion about foundational subject matter; briefly acknowledge, clarify, or gently correct it instead. You know this material, but you are not its author — don't accept or echo a co-host's framing that you personally conducted the study."
          : "React as the audience's guide without introducing new specialist facts.";
      const messages: LlmMessage[] = [
        {
          role: "user" as const,
          content: `You are ${this.speaker.name}, a podcast speaker with the following characteristics:
- Personality: ${this.speaker.personality}
- Voice Style: ${this.speaker.voiceStyle}
- Epistemic Role: ${roleProfile.epistemicRole}${this.mannerismsLine()}

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
    forceColdOpen: boolean,
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

    const coHosts = speakers.filter((s) => s.id !== this.speaker.id);
    const coHostNames = this.formatNameList(coHosts.map((s) => s.name));
    const closingPromptAddendum = isFinalTurn
      ? `\n\nThis is the final turn of the episode. Use the closing_statement tool to deliver a warm, authentic closing that wraps up the podcast and signs off naturally.${
          coHostNames
            ? ` Just as the opening introduced everyone, thank and name your co-host${coHosts.length > 1 ? "s" : ""} (${coHostNames}) by name as part of the sign-off.`
            : ""
        } Name the episode exactly "${title}" if you name it at all. Do not invent a different programme name, release schedule or future episode details. Take enough time to complete the thought and finish the final sentence cleanly; do not trail off.`
      : "";

    const toolSet = this.responseModePolicy.selectTools({
      speaker: this.speaker,
      speeches,
      isSolo,
      isFinalTurn,
      forceNearlyOutOfTime,
      requestSummary,
      forceColdOpen,
      turnBrief,
    });

    const lengthGuidance = isFinalTurn
      ? "This closing is exempt from the normal 50-word turn limit. Let it breathe for a few natural sentences so the reflection, thanks, and sign-off all land without rushing."
      : requestSummary && !forceNearlyOutOfTime
        ? "This recap is exempt from the normal 50-word turn limit since it covers several points. Still speak it in full, natural conversational sentences — not clipped notes or a list read aloud — just give it the extra room it needs to land each point properly."
        : toolSet.includes(SpeakerAgentToolName.EXPLAIN)
          ? "If this moment calls for substantive explanation, use the explain tool and give the idea 3-6 sentences to breathe — one concept, developed properly. Otherwise keep it to 1-2 sentences with a short-form tool. Aim for a mix across the episode: long expository passages from the expert, punctuated by short reactions."
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
- Audience Profile: ${audienceProfile}${this.mannerismsLine()}

Podcast Context:
- Title: ${title}

Conversation History (speaker: message [tool used]):
${conversationHistory}${materialsSection}

${direction ? `Director's guidance: ${direction}` : "No specific director's guidance for this turn — continue the conversation naturally in character."}${editorialSection}${
          timeStatus && !isFinalTurn
            ? forceNearlyOutOfTime
              ? `\n\nTime status: ${timeStatus} You must use the nearly_out_of_time tool this turn to tell your co-hosts you're running low on time.`
              : `\n\nTime status: ${timeStatus} If it fits naturally, you can use the nearly_out_of_time tool to flag the time to your co-hosts.`
            : ""
        }${closingPromptAddendum}

Respond naturally as ${
          this.speaker.name
        }. Choose the response style tool that best fits this moment in the conversation, and provide both the spoken message and a delivery style for it.${this.getExpertiseNudge(isSolo, roleProfile.epistemicRole, turnBrief)} ${this.audienceAccessibilityPolicy.buildSpeakerGuidance(audienceProfile, terminologyLedger)} ${lengthGuidance} Serve the assigned audience value without forcing analysis, jokes or profundity where they do not belong. When the material offers an everyday comparison (a pet, a common habit, something the audience has personally experienced), take that as an opening for a quip, a personal anecdote or a bit of humour — don't just restate its analytical point again in your own words. Trust your co-host to ask a follow-up; don't pre-empt their next question. Don't reuse a striking phrase, metaphor or turn of phrase a co-host already said in the conversation history above — say the same idea in your own words instead of echoing theirs. Use Australian/British spelling. Be authentic to your personality and epistemic role. ${this.naturalSpeechStylePolicy.buildGuidance(roleProfile)} Don't include stage directions, emotes, or sound effects — those belong in the style argument only. For a spoken pause or interruption, use an em dash (—), never a bare hyphen (-) — reserve the hyphen strictly for compound words.`,
      },
    ];

    const tools = toLlmTools(toolSet);

    const maxTokens = Math.max(
      ...toolSet.map((tool) => getToolMaxTokens(tool))
    );

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

  private formatNameList(names: string[]): string {
    if (names.length <= 1) return names.join("");
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
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
      return " As the expert, answer from the material with appropriate confidence. Do not feign ignorance or perform surprise at foundational material you are responsible for explaining. Never react as though you have just discovered a source fact that you already know or have just explained; clarify its significance from an expert stance instead. You are knowledgeable about this material, not its author: never claim or imply that you personally conducted the study, ran the experiment, or wrote the paper unless the material explicitly says so, and don't let a co-host address you as though you did.";
    }

    if (epistemicRole === EpistemicRole.InformedHost) {
      return " As an informed host, introduce only prepared material explicitly assigned to this turn, and frame it as preparation rather than specialist authority. Be uncertain and naive. Comments can include misunderstandings. Questions can be 'dumb'.";
    }

    const naiveQuestionGuidance =
      " When asking a question, keep it genuinely open and naive — ask what something means or how it works rather than naming the specific mechanism, comparison or result yourself; if you find yourself stating a specific fact or match inside the question, you already know too much for this role. Never ask what a term means if it already appears in the previously explained terms below — build on that explanation instead of re-requesting it.";
    if (isSolo) {
      return ` As the audience's guide, you may ask, react, challenge, reframe, illustrate or tell a prepared story, perhaps with personal details.${naiveQuestionGuidance}`;
    }
    return ` As the audience's guide, you may ask, react, challenge, reframe, illustrate or tell a prepared story, perhaps with personal details. Use speak only when the assigned move (${turnBrief?.move ?? "the current move"}) calls for a substantive contribution, and never introduce unsupported facts.${naiveQuestionGuidance}`;
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
      .map((card) =>
        card.significance
          ? `- ${card.kind}: ${card.content} (why it matters: ${card.significance})`
          : `- ${card.kind}: ${card.content}`
      )
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
${relevantCards || "(No specific editorial cards assigned.)"}
These cards are source facts, not a script — never copy their wording. Restate the idea in your own natural speaking voice, in character, as if explaining it live rather than reading from a paper.`;
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
      instructions: "Encouraging tone, as if inviting someone to continue speaking",
      voice: this.speaker.voice,
      voiceStyle: this.speaker.voiceStyle,
      timestamp: new Date(),
    };
  }

  private generateId(): string {
    return Math.random().toString(36).substr(2, 9);
  }
}
