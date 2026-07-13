import {
  EditorialMove,
  EpistemicRole,
  KnowledgeSource,
  PodcastScript,
  Speaker,
  TurnBrief,
} from "../types";
import { KnowledgeLedgerPolicy } from "./KnowledgeLedgerPolicy";
import { SpeakerRoleProfileResolver } from "./SpeakerRoleProfileResolver";

export enum RoleRepairReason {
  IncompatibleMove = "incompatible_move",
  InaccessibleKnowledge = "inaccessible_knowledge",
  NoEligibleSpeaker = "no_eligible_speaker",
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

    return `\n\nEpistemic role constraints:\n${speakerGuidance}\nAudience guides must not introduce unseen prepared cards or perform specialist explanations. Experts should introduce new technical material and must not feign ignorance of foundational material.`;
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

    const hasInaccessibleCard =
      MOVES_REQUIRING_CARD_ACCESS.includes(turnBrief.move) &&
      this.getInaccessibleKnownCardIds(script, speaker, turnBrief).length > 0;
    if (hasInaccessibleCard) {
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
}
