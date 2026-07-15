import {
  AudienceValue,
  EditorialCard,
  EditorialMove,
  EnergyLevel,
  EpistemicRole,
  KnowledgeSource,
  PodcastScript,
  Speaker,
  TurnBrief,
} from "../types";
import { SpeakerRoleProfileResolver } from "./SpeakerRoleProfileResolver";

export enum OpeningStage {
  Hook = "hook",
  Welcome = "welcome",
  Acknowledgements = "acknowledgements",
  Complete = "complete",
}

export interface OpeningTurn {
  speaker: Speaker;
  direction: string;
  timeStatus: string;
  forceNearlyOutOfTime: false;
  requestSummary: false;
  isFinalTurn: false;
  forceColdOpen: boolean;
  turnBrief: TurnBrief;
}

/**
 * Enforces the social contract at the start of an episode before the editorial
 * director takes over. State is derived from saved speeches so generation can
 * be resumed without maintaining a second mutable state store.
 */
export class OpeningSequencePolicy {
  constructor(
    private readonly roleProfileResolver = new SpeakerRoleProfileResolver()
  ) {}

  getStage(script: PodcastScript): OpeningStage {
    if (script.speakers.length === 0) return OpeningStage.Complete;
    if (script.speeches.length === 0) return OpeningStage.Hook;
    if (script.speeches.length === 1) return OpeningStage.Welcome;
    if (script.speeches.length < script.speakers.length + 1) {
      return OpeningStage.Acknowledgements;
    }
    return OpeningStage.Complete;
  }

  nextTurn(script: PodcastScript): OpeningTurn | null {
    const orderedSpeakers = this.getOpeningOrder(script.speakers);
    const stage = this.getStage(script);

    if (stage === OpeningStage.Complete) return null;

    if (stage === OpeningStage.Hook) {
      const host = orderedSpeakers[0];
      const goal =
        "Open cold — before any welcome or introductions — with a short, vivid tease of the episode's subject. Ground it in the prepared editorial material below, not general knowledge. Do not greet listeners, name the show, introduce yourself, or introduce your co-host.";
      const hookCard = this.pickHookCard(script.editorialCards ?? []);

      return this.toOpeningTurn(
        host,
        goal,
        EditorialMove.Humanise,
        true,
        hookCard ? [hookCard.id] : [],
        hookCard ? KnowledgeSource.PreparedCard : KnowledgeSource.CommonKnowledge
      );
    }

    if (stage === OpeningStage.Welcome) {
      const host = orderedSpeakers[0];
      const guests = orderedSpeakers.slice(1);
      const introductions = guests.map((speaker) => speaker.name).join(", ");
      const handover = guests.length > 0
        ? `End immediately after inviting ${introductions} to say hello. Do not introduce the subject, use a hook, mention source material or ask a substantive question.`
        : "End immediately after the welcome. Do not introduce the subject, use a hook, mention source material or ask a substantive question.";
      const goal = `Welcome listeners, name the episode \"${script.title}\", introduce yourself as ${host.name}${
        introductions ? ` and introduce ${introductions}` : ""
      }. ${handover}`;

      return this.toOpeningTurn(host, goal, EditorialMove.Humanise, false);
    }

    const speaker = orderedSpeakers[script.speeches.length - 1];
    const host = orderedSpeakers[0];
    const goal = `Respond directly to ${host.name}'s introduction. Briefly greet ${host.name} and the listeners in your own voice, then stop. Do not introduce the subject, use a hook, mention source material or begin the discussion.`;

    return this.toOpeningTurn(speaker, goal, EditorialMove.React, false);
  }

  private getOpeningOrder(speakers: Speaker[]): Speaker[] {
    const host =
      speakers.find(
        (speaker) =>
          this.roleProfileResolver.resolve(speaker).epistemicRole !==
          EpistemicRole.Expert
      ) ?? speakers[0];
    return [host, ...speakers.filter((speaker) => speaker.id !== host.id)];
  }

  private pickHookCard(cards: EditorialCard[]): EditorialCard | undefined {
    return [...cards].sort((a, b) => b.storyValue - a.storyValue)[0];
  }

  private toOpeningTurn(
    speaker: Speaker,
    goal: string,
    move: EditorialMove,
    forceColdOpen: boolean,
    cardIds: string[] = [],
    knowledgeSource: KnowledgeSource = KnowledgeSource.CommonKnowledge
  ): OpeningTurn {
    return {
      speaker,
      direction: goal,
      timeStatus: "",
      forceNearlyOutOfTime: false,
      requestSummary: false,
      isFinalTurn: false,
      forceColdOpen,
      turnBrief: {
        speakerId: speaker.id,
        goal,
        move,
        cardIds,
        audienceValue: AudienceValue.Connection,
        desiredEnergy: EnergyLevel.Warm,
        knowledgeSource,
      },
    };
  }
}
