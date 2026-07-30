import {
  AudienceValue,
  EditorialMove,
  EnergyLevel,
  EpistemicRole,
  PodcastScript,
  Speaker,
  TurnBrief,
} from "../types";
import { SpeakerRoleProfileResolver } from "./SpeakerRoleProfileResolver";

export enum ClosingStage {
  Reflection = "reflection",
  CoHostResponse = "co_host_response",
  SignOff = "sign_off",
  Complete = "complete",
}

export interface ClosingTurn {
  speaker: Speaker;
  direction: string;
  timeStatus: string;
  forceNearlyOutOfTime: false;
  requestSummary: false;
  isFinalTurn: boolean;
  turnBrief: TurnBrief;
}

/**
 * Produces a bounded, social ending sequence. The reflection and co-host
 * response are normal turns; only the final host sign-off is terminal.
 */
export class ClosingSequencePolicy {
  constructor(
    private readonly roleProfileResolver = new SpeakerRoleProfileResolver()
  ) {}

  getStage(script: PodcastScript, cursor: number): ClosingStage {
    if (cursor === 0) return ClosingStage.Reflection;
    if (script.speakers.length > 1 && cursor === 1) {
      return ClosingStage.CoHostResponse;
    }
    if (cursor <= (script.speakers.length > 1 ? 2 : 1)) {
      return ClosingStage.SignOff;
    }
    return ClosingStage.Complete;
  }

  nextTurn(script: PodcastScript, cursor: number): ClosingTurn | null {
    const stage = this.getStage(script, cursor);
    if (stage === ClosingStage.Complete || script.speakers.length === 0) {
      return null;
    }

    const host = this.getHost(script.speakers);
    if (stage === ClosingStage.Reflection) {
      return this.toTurn(
        host,
        "Begin the ending phase with one concise reflective takeaway from the episode's central throughline. Do not recap every point, introduce a new topic, thank listeners, or sign off; leave room for your co-host to respond.",
        EditorialMove.FindMeaning,
        false
      );
    }

    if (stage === ClosingStage.CoHostResponse) {
      const coHost =
        script.speakers.find((speaker) => speaker.id !== host.id) ?? host;
      return this.toTurn(
        coHost,
        `Respond directly to ${host.name}'s reflection with your own brief final perspective. Add emotional resolution without introducing a new fact, thanking listeners, or signing off; hand the conversational space back to ${host.name}.`,
        EditorialMove.React,
        false
      );
    }

    return this.toTurn(
      host,
      "Deliver the final host sign-off. Draw one short line through the two preceding reflections, address listeners directly, thank the co-host by name, thank the audience, and end with an explicit farewell. Do not add a new fact or question.",
      EditorialMove.Summarise,
      true
    );
  }

  private getHost(speakers: Speaker[]): Speaker {
    return (
      speakers.find(
        (speaker) =>
          this.roleProfileResolver.resolve(speaker).epistemicRole !==
          EpistemicRole.Expert
      ) ?? speakers[0]
    );
  }

  private toTurn(
    speaker: Speaker,
    goal: string,
    move: EditorialMove,
    isFinalTurn: boolean
  ): ClosingTurn {
    return {
      speaker,
      direction: goal,
      timeStatus: "",
      forceNearlyOutOfTime: false,
      requestSummary: false,
      isFinalTurn,
      turnBrief: {
        speakerId: speaker.id,
        goal,
        move,
        cardIds: [],
        audienceValue: AudienceValue.Connection,
        desiredEnergy: EnergyLevel.Reflective,
      },
    };
  }
}
