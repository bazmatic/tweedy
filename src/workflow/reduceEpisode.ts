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
    case "closing":
      throw new InvalidTransitionError(state.phase, event.type);
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

// Referenced by later tasks; kept here so the PendingTurn import is used.
export type { PendingTurn };
