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
      return {
        ...state,
        phase: "opening",
        discussionPoints:
          event.discussionPointIds?.map((id) => ({ id, covered: false })) ??
          state.discussionPoints,
        conversationBeats:
          event.conversationBeatIds?.map((id) => ({ id, covered: false })) ??
          state.conversationBeats,
        discourseClaims:
          event.discourseClaimIds?.map((id) => ({ id, covered: false })) ??
          state.discourseClaims,
        lastAppliedEvent: event.type,
      };
    case "WORKFLOW_WARNING_RECORDED":
      return { ...state, warnings: [...state.warnings, event.message], lastAppliedEvent: event.type };
    default:
      throw new InvalidTransitionError(state.phase, event.type);
  }
}

function reduceOpening(state: EpisodeState, event: EpisodeEvent): EpisodeState {
  switch (event.type) {
    case "OPENING_ADVANCED":
      if (state.pendingTurn !== null) {
        throw new InvalidTransitionError(
          state.phase,
          event.type,
          "cannot advance while an opening turn is pending"
        );
      }
      return {
        ...state,
        openingCursor: state.openingCursor + 1,
        phase: event.isFinalOpeningTurn ? "discussion" : "opening",
        lastAppliedEvent: event.type,
      };
    case "WORKFLOW_WARNING_RECORDED":
      return { ...state, warnings: [...state.warnings, event.message], lastAppliedEvent: event.type };
    default:
      // Opening speeches use the same pending -> reviewed -> persisted ->
      // accepted transaction as discussion speeches. OPENING_ADVANCED remains
      // a separate event so a rejected candidate cannot move the cursor.
      return reduceTurnPipeline(state, event, "opening");
  }
}

function reduceTurnPipeline(
  state: EpisodeState,
  event: EpisodeEvent,
  phase: "opening" | "discussion" | "closing"
): EpisodeState {
  switch (event.type) {
    case "TURN_DIRECTED": {
      if (state.pendingTurn !== null) {
        throw new InvalidTransitionError(phase, event.type, "a turn is already pending");
      }
      const pendingTurn: PendingTurn = {
        kind: event.kind,
        logicalTurn: event.logicalTurn ?? state.turnsUsed,
        idempotencyKey:
          event.idempotencyKey ??
          `${state.episodeId}/${state.workflowRunId}/${event.logicalTurn ?? state.turnsUsed}/${event.kind}`,
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
    case "TURN_REVISED": {
      if (
        state.pendingTurn === null ||
        state.pendingTurn.candidateMessage === null ||
        state.pendingTurn.reviewApproved !== false
      ) {
        throw new InvalidTransitionError(
          phase,
          event.type,
          "no rejected review awaiting revision"
        );
      }
      return {
        ...state,
        pendingTurn: {
          ...state.pendingTurn,
          candidateMessage: event.message,
          candidateStopReason: event.stopReason,
          reviewNotes: null,
          reviewApproved: null,
        },
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
        consecutiveRejectedTurns: state.consecutiveRejectedTurns + 1,
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
        consecutiveRejectedTurns: 0,
        acceptedSpeechIds: [...state.acceptedSpeechIds, event.speechId],
        turnsUsed: state.pendingTurn.kind === "speech" ? state.turnsUsed + 1 : state.turnsUsed,
        elapsedDurationEstimateSeconds: state.elapsedDurationEstimateSeconds + event.durationSeconds,
        discussionPoints: state.discussionPoints.map((point) =>
          coveredPointIds.has(point.id) ? { ...point, covered: true } : point
        ),
        conversationBeats: state.conversationBeats.map((beat) =>
          coveredBeatIds.has(beat.id) ? { ...beat, covered: true } : beat
        ),
        discourseClaims: state.discourseClaims.map((claim) =>
          (event.establishedDiscourseClaimIds ?? []).includes(claim.id)
            ? { ...claim, covered: true }
            : claim
        ),
        teasedDiscourseClaimIds: [
          ...new Set([
            ...state.teasedDiscourseClaimIds,
            ...(event.teasedDiscourseClaimIds ?? []),
          ]),
        ],
        knowledgeLedger: [
          ...new Set([...state.knowledgeLedger, ...(event.introducedKnowledgeIds ?? [])]),
        ],
        terminologyLedger: [
          ...new Set([...state.terminologyLedger, ...(event.introducedTerms ?? [])]),
        ],
        lastAppliedEvent: event.type,
      };
    }
    case "INTERJECTION_REQUESTED": {
      if (state.pendingTurn !== null) {
        throw new InvalidTransitionError(phase, event.type, "a turn is already pending");
      }
      const pendingTurn: PendingTurn = {
        kind: "interjection",
        logicalTurn: event.logicalTurn ?? state.turnsUsed,
        idempotencyKey:
          event.idempotencyKey ??
          `${state.episodeId}/${state.workflowRunId}/${event.logicalTurn ?? state.turnsUsed}/interjection`,
        speakerId: event.speakerId,
        direction: event.direction,
        candidateMessage: null,
        candidateStopReason: null,
        reviewNotes: null,
        reviewApproved: null,
      };
      return { ...state, pendingTurn, lastAppliedEvent: event.type };
    }
    case "CLOSING_REQUESTED": {
      if (phase !== "discussion") {
        throw new InvalidTransitionError(phase, event.type);
      }
      if (state.pendingTurn !== null) {
        throw new InvalidTransitionError(phase, event.type, "cannot close while a turn is pending");
      }
      return {
        ...state,
        phase: "closing",
        terminationRequested: true,
        terminationReason: event.reason,
        lastAppliedEvent: event.type,
      };
    }
    case "CLOSING_ADVANCED": {
      if (phase !== "closing") {
        throw new InvalidTransitionError(phase, event.type);
      }
      if (state.pendingTurn !== null) {
        throw new InvalidTransitionError(
          phase,
          event.type,
          "cannot advance while a closing turn is pending"
        );
      }
      return {
        ...state,
        closingCursor: state.closingCursor + 1,
        lastAppliedEvent: event.type,
      };
    }
    case "EPISODE_COMPLETED": {
      if (phase !== "closing") {
        throw new InvalidTransitionError(phase, event.type);
      }
      if (state.pendingTurn !== null) {
        throw new InvalidTransitionError(phase, event.type, "cannot complete while a turn is pending");
      }
      return { ...state, phase: "completed", lastAppliedEvent: event.type };
    }
    case "WORKFLOW_WARNING_RECORDED":
      return { ...state, warnings: [...state.warnings, event.message], lastAppliedEvent: event.type };
    default:
      throw new InvalidTransitionError(phase, event.type);
  }
}

// Referenced by later tasks; kept here so the PendingTurn import is used.
export type { PendingTurn };
