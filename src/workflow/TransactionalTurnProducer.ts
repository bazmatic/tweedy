import { EpisodeEvent } from "./episode-events";
import { EpisodeState, PendingTurnKind, StopReason } from "./episode-schemas";
import { reduceEpisode } from "./reduceEpisode";

export interface TurnCandidate {
  message: string;
  stopReason: StopReason;
}

export interface TurnReviewResult {
  approved: boolean;
  notes: string;
}

export interface PersistedTurn {
  speechId: string;
  durationSeconds: number;
  coveredDiscussionPointIds?: string[];
  coveredConversationBeatIds?: string[];
  introducedKnowledgeIds?: string[];
  introducedTerms?: string[];
  establishedDiscourseClaimIds?: string[];
  teasedDiscourseClaimIds?: string[];
}

export interface ProduceTurnOperations<TCandidate extends TurnCandidate> {
  generate(): Promise<TCandidate>;
  review(candidate: TCandidate): Promise<TurnReviewResult>;
  validateIntegrity(candidate: TCandidate): Promise<string | null>;
  validateRepetition(candidate: TCandidate): Promise<string | null>;
  persist(candidate: TCandidate, idempotencyKey: string): Promise<PersistedTurn>;
}

export interface ProduceTurnRequest<TCandidate extends TurnCandidate> {
  state: EpisodeState;
  kind: PendingTurnKind;
  logicalTurn: number;
  speakerId: string;
  direction: string;
  operations: ProduceTurnOperations<TCandidate>;
  now?: () => string;
  /** Recovery hook useful for simulating a crash after durable persistence. */
  afterPersist?: (persisted: PersistedTurn) => Promise<void> | void;
}

export interface ProduceTurnResult<TCandidate extends TurnCandidate> {
  state: EpisodeState;
  candidate: TCandidate | null;
  events: EpisodeEvent[];
  accepted: boolean;
  persisted: PersistedTurn | null;
}

export function turnIdempotencyKey(
  episodeId: string,
  workflowRunId: string,
  logicalTurn: number,
  kind: PendingTurnKind
): string {
  return [episodeId, workflowRunId, logicalTurn, kind]
    .map((part) => encodeURIComponent(String(part)))
    .join("/");
}

/** Runs one turn without exposing the candidate as accepted before persistence. */
export async function produceTurn<TCandidate extends TurnCandidate>(
  request: ProduceTurnRequest<TCandidate>
): Promise<ProduceTurnResult<TCandidate>> {
  const events: EpisodeEvent[] = [];
  let state = request.state;
  const timestamp = request.now ?? (() => new Date().toISOString());
  const idempotencyKey = turnIdempotencyKey(
    state.episodeId,
    state.workflowRunId,
    request.logicalTurn,
    request.kind
  );
  const apply = (event: EpisodeEvent) => {
    events.push(event);
    state = reduceEpisode(state, event);
  };

  apply(
    request.kind === "interjection"
      ? {
          type: "INTERJECTION_REQUESTED",
          timestamp: timestamp(),
          speakerId: request.speakerId,
          direction: request.direction,
          logicalTurn: request.logicalTurn,
          idempotencyKey,
        }
      : {
          type: "TURN_DIRECTED",
          timestamp: timestamp(),
          speakerId: request.speakerId,
          direction: request.direction,
          kind: request.kind,
          logicalTurn: request.logicalTurn,
          idempotencyKey,
        }
  );

  let candidate: TCandidate;
  try {
    candidate = await request.operations.generate();
  } catch {
    // Generation has produced no durable or accepted change. Retry from the input state.
    return { state: request.state, candidate: null, events, accepted: false, persisted: null };
  }
  apply({
    type: "TURN_GENERATED",
    timestamp: timestamp(),
    message: candidate.message,
    stopReason: candidate.stopReason,
  });

  let review: TurnReviewResult;
  try {
    review = await request.operations.review(candidate);
  } catch {
    review = { approved: true, notes: "Reviewer unavailable; accepted fail-open" };
  }
  apply({ type: "TURN_REVIEWED", timestamp: timestamp(), ...review });

  const rejectionReason =
    (!review.approved && (review.notes || "Editorial review rejected the candidate")) ||
    (await request.operations.validateIntegrity(candidate)) ||
    (await request.operations.validateRepetition(candidate));
  if (rejectionReason) {
    apply({ type: "TURN_REJECTED", timestamp: timestamp(), reason: rejectionReason });
    return { state, candidate, events, accepted: false, persisted: null };
  }

  const persisted = await request.operations.persist(candidate, idempotencyKey);
  await request.afterPersist?.(persisted);
  apply({
    type: "TURN_ACCEPTED",
    timestamp: timestamp(),
    speechId: persisted.speechId,
    durationSeconds: persisted.durationSeconds,
    coveredDiscussionPointIds: persisted.coveredDiscussionPointIds ?? [],
    coveredConversationBeatIds: persisted.coveredConversationBeatIds ?? [],
    introducedKnowledgeIds: persisted.introducedKnowledgeIds ?? [],
    introducedTerms: persisted.introducedTerms ?? [],
  });
  return { state, candidate, events, accepted: true, persisted };
}
