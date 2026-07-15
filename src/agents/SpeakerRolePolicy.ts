import {
  EditorialMove,
  EpistemicRole,
  KnowledgeSource,
  PodcastScript,
  SourceAccess,
  Speaker,
  TurnBrief,
} from "../types";
import { KnowledgeLedgerPolicy } from "./KnowledgeLedgerPolicy";
import { SpeakerRoleProfileResolver } from "./SpeakerRoleProfileResolver";

export enum RoleRepairReason {
  IncompatibleMove = "incompatible_move",
  InaccessibleKnowledge = "inaccessible_knowledge",
  NoEligibleSpeaker = "no_eligible_speaker",
  SelfTargetingDirection = "self_targeting_direction",
  UnexplainedTerminology = "unexplained_terminology",
}

const TERM_BOUNDARY = /[^a-z0-9]+/g;

enum SelfTargetingCue {
  Ask = "ask ",
  BringIn = "bring in ",
  Get = "get ",
  HandOver = "hand over to ",
  Invite = "invite ",
  SetUp = "set up ",
  SetsUp = "sets up ",
  Tee = "tee ",
  Tees = "tees ",
  TurnTo = "turn to ",
}

export interface RoleAssignment {
  speaker: Speaker;
  direction: string;
  turnBrief: TurnBrief;
  repaired: boolean;
  repairReason?: RoleRepairReason;
}

interface RoleEvaluation {
  valid: boolean;
  repairReason?: RoleRepairReason;
}

const ROLE_ALLOWED_MOVES: Readonly<Record<EpistemicRole, readonly EditorialMove[]>> =
  Object.freeze({
    [EpistemicRole.Expert]: Object.freeze(Object.values(EditorialMove)),
    [EpistemicRole.InformedHost]: Object.freeze(Object.values(EditorialMove)),
    [EpistemicRole.AudienceGuide]: Object.freeze([
      EditorialMove.Illustrate,
      EditorialMove.TellStory,
      EditorialMove.Connect,
      EditorialMove.Reframe,
      EditorialMove.Question,
      EditorialMove.Challenge,
      EditorialMove.React,
      EditorialMove.Humanise,
      EditorialMove.FindMeaning,
      EditorialMove.Summarise,
      EditorialMove.Transition,
    ]),
  });

const REPAIRED_DIRECTION_PREFIX =
  "Fulfil this goal from your established epistemic role without pretending to know less or more than you do:";
const SAFE_LISTENER_QUESTION_GOAL =
  "Invite the expert to introduce the next idea for listeners.";
const SAFE_LISTENER_QUESTION_DIRECTION =
  "Ask the expert one concise listener-centred question that invites the next idea. Do not state technical detail or suggest a possible answer.";

const MOVES_REQUIRING_CARD_ACCESS = Object.freeze([
  EditorialMove.Explain,
  EditorialMove.Illustrate,
  EditorialMove.TellStory,
  EditorialMove.AddContext,
  EditorialMove.Compare,
  EditorialMove.Contrast,
  EditorialMove.Connect,
  EditorialMove.Reframe,
  EditorialMove.Summarise,
]);

/** Enforces speaker-role boundaries after the director proposes a turn. */
export class SpeakerRolePolicy {
  constructor(
    private readonly roleProfileResolver = new SpeakerRoleProfileResolver(),
    private readonly knowledgeLedgerPolicy = new KnowledgeLedgerPolicy(
      roleProfileResolver
    )
  ) {}

  repairAssignment(
    script: PodcastScript,
    proposedSpeaker: Speaker,
    turnBrief: TurnBrief,
    direction: string
  ): RoleAssignment {
    if (this.targetsProposedSpeaker(proposedSpeaker, turnBrief, direction)) {
      const alternativeSpeaker = script.speakers.find(
        (speaker) =>
          speaker.id !== proposedSpeaker.id &&
          this.isAssignmentValid(script, speaker, turnBrief)
      );
      if (alternativeSpeaker) {
        return {
          speaker: alternativeSpeaker,
          direction,
          turnBrief: {
            ...turnBrief,
            speakerId: alternativeSpeaker.id,
            knowledgeSource: this.getKnowledgeSource(alternativeSpeaker),
          },
          repaired: true,
          repairReason: RoleRepairReason.SelfTargetingDirection,
        };
      }
    }

    const inaccessibleCardIds = this.getInaccessibleKnownCardIds(
      script,
      proposedSpeaker,
      turnBrief
    );
    if (
      inaccessibleCardIds.length > 0 &&
      !MOVES_REQUIRING_CARD_ACCESS.includes(turnBrief.move)
    ) {
      return {
        speaker: proposedSpeaker,
        direction: SAFE_LISTENER_QUESTION_DIRECTION,
        turnBrief: {
          ...turnBrief,
          goal: SAFE_LISTENER_QUESTION_GOAL,
          move: EditorialMove.Question,
          cardIds: [],
          knowledgeSource: KnowledgeSource.Conversation,
        },
        repaired: true,
        repairReason: RoleRepairReason.InaccessibleKnowledge,
      };
    }

    const unexplainedTerm = this.findUnexplainedTerm(
      script,
      proposedSpeaker,
      turnBrief,
      direction
    );
    if (unexplainedTerm) {
      return {
        speaker: proposedSpeaker,
        direction: this.buildClarificationDirection(script, unexplainedTerm),
        turnBrief: {
          ...turnBrief,
          goal: `Ask for a plain-language explanation of "${unexplainedTerm}".`,
          move: EditorialMove.Question,
          cardIds: [],
          knowledgeSource: KnowledgeSource.Conversation,
        },
        repaired: true,
        repairReason: RoleRepairReason.UnexplainedTerminology,
      };
    }

    const evaluation = this.evaluateAssignment(
      script,
      proposedSpeaker,
      turnBrief
    );
    if (evaluation.valid) {
      return {
        speaker: proposedSpeaker,
        direction,
        turnBrief: {
          ...turnBrief,
          knowledgeSource: this.getKnowledgeSource(proposedSpeaker),
        },
        repaired: false,
      };
    }

    const eligibleSpeaker = script.speakers.find((speaker) =>
      this.isAssignmentValid(script, speaker, turnBrief)
    );
    if (eligibleSpeaker) {
      return {
        speaker: eligibleSpeaker,
        direction: `${REPAIRED_DIRECTION_PREFIX} ${turnBrief.goal}`,
        turnBrief: {
          ...turnBrief,
          speakerId: eligibleSpeaker.id,
          knowledgeSource: this.getKnowledgeSource(eligibleSpeaker),
        },
        repaired: true,
        repairReason: evaluation.repairReason,
      };
    }

    const accessibleCardIds = turnBrief.cardIds.filter((cardId) =>
      this.knowledgeLedgerPolicy.canAccessCard(
        proposedSpeaker,
        cardId,
        script.knowledgeLedger ?? this.knowledgeLedgerPolicy.createLedger(),
        turnBrief.cardIds
      )
    );
    return {
      speaker: proposedSpeaker,
      direction: `${REPAIRED_DIRECTION_PREFIX} Ask a listener-centred question about ${turnBrief.goal}`,
      turnBrief: {
        ...turnBrief,
        move: EditorialMove.Question,
        cardIds: accessibleCardIds,
        knowledgeSource: KnowledgeSource.Conversation,
      },
      repaired: true,
      repairReason: RoleRepairReason.NoEligibleSpeaker,
    };
  }

  buildDirectorGuidance(script: PodcastScript): string {
    const speakerGuidance = script.speakers
      .map((speaker) => {
        const profile = this.roleProfileResolver.resolve(speaker);
        return `- ${speaker.name}: ${profile.epistemicRole}; permitted moves: ${ROLE_ALLOWED_MOVES[
          profile.epistemicRole
        ].join(", ")}`;
      })
      .join("\n");

    return `\n\nEpistemic role constraints:\n${speakerGuidance}\nAudience guides must not introduce unseen prepared cards or perform specialist explanations. Experts should introduce new technical material and must not feign ignorance of foundational material. Never select a speaker for a brief that asks them to ask, invite, tee up, or hand over to themselves.`;
  }

  private targetsProposedSpeaker(
    proposedSpeaker: Speaker,
    turnBrief: TurnBrief,
    direction: string
  ): boolean {
    const assignmentText = `${turnBrief.goal} ${direction}`.toLocaleLowerCase();
    const speakerName = proposedSpeaker.name.toLocaleLowerCase();
    return Object.values(SelfTargetingCue).some((cue) =>
      assignmentText.includes(`${cue}${speakerName}`)
    );
  }

  private isAssignmentValid(
    script: PodcastScript,
    speaker: Speaker,
    turnBrief: TurnBrief
  ): boolean {
    return this.evaluateAssignment(script, speaker, turnBrief).valid;
  }

  private getKnowledgeSource(speaker: Speaker): KnowledgeSource {
    const profile = this.roleProfileResolver.resolve(speaker);
    if (profile.epistemicRole === EpistemicRole.Expert) {
      return KnowledgeSource.SourceMaterial;
    }
    if (profile.epistemicRole === EpistemicRole.InformedHost) {
      return KnowledgeSource.PreparedCard;
    }
    return KnowledgeSource.Conversation;
  }

  private evaluateAssignment(
    script: PodcastScript,
    speaker: Speaker,
    turnBrief: TurnBrief
  ): RoleEvaluation {
    const profile = this.roleProfileResolver.resolve(speaker);
    if (!ROLE_ALLOWED_MOVES[profile.epistemicRole].includes(turnBrief.move)) {
      return {
        valid: false,
        repairReason: RoleRepairReason.IncompatibleMove,
      };
    }

    const requiresPreparedKnowledge = MOVES_REQUIRING_CARD_ACCESS.includes(
      turnBrief.move
    );
    const ledger =
      script.knowledgeLedger ?? this.knowledgeLedgerPolicy.createLedger();
    const heardOnlySpeakerHasNoSharedKnowledge =
      profile.sourceAccess === SourceAccess.HeardOnly &&
      requiresPreparedKnowledge &&
      turnBrief.cardIds.length === 0 &&
      ledger.introducedCards.length === 0;
    const hasInaccessibleCard =
      requiresPreparedKnowledge &&
      this.getInaccessibleKnownCardIds(script, speaker, turnBrief).length > 0;
    if (hasInaccessibleCard || heardOnlySpeakerHasNoSharedKnowledge) {
      return {
        valid: false,
        repairReason: RoleRepairReason.InaccessibleKnowledge,
      };
    }
    return { valid: true };
  }

  private getInaccessibleKnownCardIds(
    script: PodcastScript,
    speaker: Speaker,
    turnBrief: TurnBrief
  ): string[] {
    const ledger =
      script.knowledgeLedger ?? this.knowledgeLedgerPolicy.createLedger();
    const knownCardIds = new Set(
      (script.editorialCards ?? []).map((card) => card.id)
    );
    return turnBrief.cardIds.filter(
      (cardId) =>
        knownCardIds.has(cardId) &&
        !this.knowledgeLedgerPolicy.canAccessCard(
          speaker,
          cardId,
          ledger,
          turnBrief.cardIds
        )
    );
  }

  /**
   * A non-expert speaker's direction/goal is free text the director writes
   * itself, unconstrained by cardIds — so it can name a card's key term
   * directly (e.g. "ask Ada about the complexity score") even when the
   * speaker has no access to that card. Catch that deterministically by
   * checking the assigned text against every prepared card's keyTerms, since
   * "is this word jargon" isn't otherwise something we can judge in code.
   * Returns the term's original (un-normalised) form so it can be quoted
   * back naturally in the repaired direction.
   */
  private findUnexplainedTerm(
    script: PodcastScript,
    speaker: Speaker,
    turnBrief: TurnBrief,
    direction: string
  ): string | undefined {
    const profile = this.roleProfileResolver.resolve(speaker);
    if (profile.epistemicRole === EpistemicRole.Expert) return undefined;

    const cards = script.editorialCards ?? [];
    if (cards.length === 0) return undefined;

    const explainedTerms = new Set(
      (script.terminologyLedger?.explainedTerms ?? []).map((entry) =>
        this.normaliseTerm(entry.term)
      )
    );
    const assignmentText = ` ${this.normaliseTerm(
      `${turnBrief.goal} ${direction}`
    )} `;

    for (const card of cards) {
      for (const term of card.keyTerms ?? []) {
        const normalisedTerm = this.normaliseTerm(term);
        if (
          normalisedTerm.length > 0 &&
          !explainedTerms.has(normalisedTerm) &&
          assignmentText.includes(` ${normalisedTerm} `)
        ) {
          return term;
        }
      }
    }
    return undefined;
  }

  /**
   * Rather than discarding the term the guide stumbled on, have them ask
   * the expert to define it — a natural, curiosity-driven turn instead of a
   * generic redirect that loses the thread.
   */
  private buildClarificationDirection(
    script: PodcastScript,
    term: string
  ): string {
    const expert = script.speakers.find(
      (speaker) =>
        this.roleProfileResolver.resolve(speaker).epistemicRole ===
        EpistemicRole.Expert
    );
    const askee = expert ? expert.name : "the expert";
    return `You've just heard the term "${term}" but don't know what it means yet — ask ${askee} to explain it in plain language before the conversation continues.`;
  }

  private normaliseTerm(value: string): string {
    return value.toLowerCase().replace(TERM_BOUNDARY, " ").trim();
  }
}
