import { EpisodeEvent } from "./episode-events";
import { EpisodeState, PendingTurn } from "./episode-schemas";

export class InvalidTransitionError extends Error {
  constructor(phase: string, eventType: string, detail?: string) {
    super(`Cannot apply event "${eventType}" in phase "${phase}"${detail ? `: ${detail}` : ""}`);
    this.name = "InvalidTransitionError";
  }
}

export function reduceEpisode(state: EpisodeState, event: EpisodeEvent): EpisodeState {
  switch (state.phase) {
    case "preparing":
      return reducePreparing(state, event);
    case "opening":
      return reduceOpening(state, event);
    case "discussion":
      return reduceTurnPipeline(state, event, "discussion");
    case "closing":
      return reduceTurnPipeline(state, event, "closing");
    case "completed":
    case "failed":
      throw new InvalidTransitionError(state.phase, event.type, "terminal phase");
    default:
      throw new InvalidTransitionError(state.phase, event.type);
  }
}

function reducePreparing(state: EpisodeState, event: EpisodeEvent): EpisodeState {
  switch (event.type) {
    case "EPISODE_INITIALISED":
    case "MATERIALS_PREPARED":
      return { ...state, lastAppliedEvent: event.type };
    case "ROLES_ASSIGNED":
      return {
        ...state,
        speakerRoleAssignments: { ...event.assignments },
        lastAppliedEvent: event.type,
      };
    case "PLAN_CREATED":
      return { ...state, phase: "opening", lastAppliedEvent: event.type };
    case "WORKFLOW_WARNING_RECORDED":
      return { ...state, warnings: [...state.warnings, event.message], lastAppliedEvent: event.type };
    default:
      throw new InvalidTransitionError(state.phase, event.type);
  }
}

function reduceOpening(state: EpisodeState, event: EpisodeEvent): EpisodeState {
  switch (event.type) {
    case "OPENING_ADVANCED":
      return {
        ...state,
        openingCursor: state.openingCursor + 1,
        phase: event.isFinalOpeningTurn ? "discussion" : "opening",
        lastAppliedEvent: event.type,
      };
    case "WORKFLOW_WARNING_RECORDED":
      return { ...state, warnings: [...state.warnings, event.message], lastAppliedEvent: event.type };
    default:
      throw new InvalidTransitionError(state.phase, event.type);
  }
}

function reduceTurnPipeline(
  state: EpisodeState,
  event: EpisodeEvent,
  phase: "discussion" | "closing"
): EpisodeState {
  switch (event.type) {
    case "TURN_DIRECTED": {
      if (state.pendingTurn !== null) {
        throw new InvalidTransitionError(phase, event.type, "a turn is already pending");
      }
      const pendingTurn: PendingTurn = {
        kind: event.kind,
        speakerId: event.speakerId,
        direction: event.direction,
        candidateMessage: null,
        candidateStopReason: null,
        reviewNotes: null,
        reviewApproved: null,
      };
      return { ...state, pendingTurn, lastAppliedEvent: event.type };
    }
    case "TURN_GENERATED": {
      if (state.pendingTurn === null || state.pendingTurn.candidateMessage !== null) {
        throw new InvalidTransitionError(phase, event.type, "no directed turn awaiting a candidate");
      }
      return {
        ...state,
        pendingTurn: {
          ...state.pendingTurn,
          candidateMessage: event.message,
          candidateStopReason: event.stopReason,
        },
        lastAppliedEvent: event.type,
      };
    }
    case "TURN_REVIEWED": {
      if (
        state.pendingTurn === null ||
        state.pendingTurn.candidateMessage === null ||
        state.pendingTurn.reviewApproved !== null
      ) {
        throw new InvalidTransitionError(phase, event.type, "no generated candidate awaiting review");
      }
      return {
        ...state,
        pendingTurn: { ...state.pendingTurn, reviewNotes: event.notes, reviewApproved: event.approved },
        lastAppliedEvent: event.type,
      };
    }
    case "TURN_REJECTED": {
      if (state.pendingTurn === null || state.pendingTurn.reviewApproved === null) {
        throw new InvalidTransitionError(phase, event.type, "no reviewed candidate to reject");
      }
      return {
        ...state,
        pendingTurn: null,
        warnings: [...state.warnings, event.reason],
        lastAppliedEvent: event.type,
      };
    }
    case "TURN_ACCEPTED": {
      if (state.pendingTurn === null || state.pendingTurn.reviewApproved !== true) {
        throw new InvalidTransitionError(phase, event.type, "no approved candidate to accept");
      }
      const coveredPointIds = new Set(event.coveredDiscussionPointIds);
      const coveredBeatIds = new Set(event.coveredConversationBeatIds);
      return {
        ...state,
        pendingTurn: null,
        acceptedSpeechIds: [...state.acceptedSpeechIds, event.speechId],
        turnsUsed: state.pendingTurn.kind === "speech" ? state.turnsUsed + 1 : state.turnsUsed,
        elapsedDurationEstimateSeconds: state.elapsedDurationEstimateSeconds + event.durationSeconds,
        discussionPoints: state.discussionPoints.map((point) =>
          coveredPointIds.has(point.id) ? { ...point, covered: true } : point
        ),
        conversationBeats: state.conversationBeats.map((beat) =>
          coveredBeatIds.has(beat.id) ? { ...beat, covered: true } : beat
        ),
        lastAppliedEvent: event.type,
      };
    }
    default:
      throw new InvalidTransitionError(phase, event.type);
  }
}

// Referenced by later tasks; kept here so the PendingTurn import is used.
export type { PendingTurn };
