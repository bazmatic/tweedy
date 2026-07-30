import { createStep, createWorkflow } from "@mastra/core/workflows";
import type { TracingContext } from "@mastra/core/observability";
import { z } from "zod";
import { ModelTask } from "../providers/ModelRoutingPolicy";
import { EpisodeEvent } from "../workflow/episode-events";
import {
  EpisodeDefinitionSchema,
  EpisodeState,
  EpisodeStateSchema,
  PendingTurnKind,
  StopReasonSchema,
  createInitialEpisodeState,
} from "../workflow/episode-schemas";
import { reduceEpisode } from "../workflow/reduceEpisode";
import {
  PersistedTurn,
  TurnReviewResult,
  turnIdempotencyKey,
} from "../workflow/TransactionalTurnProducer";
import { TraceSink } from "./tracing";

export const EPISODE_FLOW_VERSION = "mastra-episode-v1";

const WorkflowLimitsSchema = z.object({
  maxTurns: z.number().int().positive(),
  maxDurationSeconds: z.number().positive(),
  maxIterations: z.number().int().positive(),
});

export const EpisodeWorkflowInputSchema = z.object({
  definition: EpisodeDefinitionSchema,
  maxTurns: z.number().int().positive(),
  maxDurationSeconds: z.number().positive(),
});

const TokenUsageSchema = z
  .object({
    input: z.number().nonnegative().optional(),
    output: z.number().nonnegative().optional(),
    total: z.number().nonnegative().optional(),
  })
  .optional();

export const TurnSelectionSchema = z.object({
  kind: z.enum(["speech", "interjection"]),
  logicalTurn: z.number().int().nonnegative(),
  speakerId: z.string().min(1),
  direction: z.string(),
  isOpeningTurn: z.boolean(),
  isFinalOpeningTurn: z.boolean(),
  isClosingTurn: z.boolean().default(false),
  isFinalClosingTurn: z.boolean().default(false),
  isFinalTurn: z.boolean(),
  wasRepaired: z.boolean().default(false),
  modelTask: z.nativeEnum(ModelTask).default(ModelTask.DirectionSelection),
});
export type TurnSelection = z.infer<typeof TurnSelectionSchema>;

export const WorkflowCandidateSchema = z.object({
  message: z.string(),
  stopReason: StopReasonSchema,
  tokenUsage: TokenUsageSchema,
  data: z.record(z.string(), z.unknown()).default({}),
});
export type WorkflowCandidate = z.infer<typeof WorkflowCandidateSchema>;

const WorkflowReviewSchema = z.object({
  approved: z.boolean(),
  notes: z.string(),
});
type WorkflowReview = z.infer<typeof WorkflowReviewSchema>;

export interface WorkflowReviewResult extends TurnReviewResult {
  /**
   * A reviewer may return a rewritten candidate. Keeping it explicit avoids
   * mutating a snapshotted step input behind Mastra's back.
   */
  candidate?: WorkflowCandidate;
}

export const EpisodeWorkflowEnvelopeSchema = z.object({
  state: EpisodeStateSchema,
  speakerIds: z.array(z.string()),
  limits: WorkflowLimitsSchema,
  iteration: z.number().int().nonnegative(),
  inspection: z.record(z.string(), z.unknown()).nullable(),
  selection: TurnSelectionSchema.nullable(),
  candidate: WorkflowCandidateSchema.nullable(),
  review: WorkflowReviewSchema.nullable(),
  rejectionReason: z.string().nullable(),
  accepted: z.boolean().nullable(),
  lastAcceptedSpeechId: z.string().nullable(),
  lastTurnWasOpening: z.boolean(),
  lastTurnWasFinal: z.boolean(),
});
export type EpisodeWorkflowEnvelope = z.infer<
  typeof EpisodeWorkflowEnvelopeSchema
>;

export const EpisodeWorkflowOutputSchema = z.object({
  state: EpisodeStateSchema,
  episodeId: z.string(),
  runId: z.string(),
  flowVersion: z.literal(EPISODE_FLOW_VERSION),
});

export interface EpisodePreparationResult {
  discussionPointIds?: string[];
  conversationBeatIds?: string[];
  discourseClaimIds?: string[];
}

export interface EpisodeWorkflowDependencies {
  prepareMaterials(episodeId: string): Promise<void>;
  assignSpeakerRoles(
    episodeId: string,
    speakerIds: string[],
    tracingContext?: TracingContext
  ): Promise<Record<string, string>>;
  createPlan(
    episodeId: string,
    tracingContext?: TracingContext
  ): Promise<EpisodePreparationResult>;
  inspectEpisode(state: EpisodeState): Promise<Record<string, unknown>>;
  proposeTurn(
    state: EpisodeState,
    inspection: Record<string, unknown>,
    tracingContext?: TracingContext
  ): Promise<TurnSelection>;
  repairTurn(
    state: EpisodeState,
    proposal: TurnSelection,
    inspection: Record<string, unknown>
  ): Promise<TurnSelection>;
  forceClosingTurn(state: EpisodeState, reason: string): Promise<TurnSelection>;
  generateCandidate(
    state: EpisodeState,
    selection: TurnSelection,
    tracingContext?: TracingContext
  ): Promise<WorkflowCandidate>;
  reviewCandidate(
    state: EpisodeState,
    selection: TurnSelection,
    candidate: WorkflowCandidate,
    tracingContext?: TracingContext
  ): Promise<WorkflowReviewResult>;
  reviseCandidate?(
    state: EpisodeState,
    selection: TurnSelection,
    candidate: WorkflowCandidate,
    review: TurnReviewResult
  ): Promise<WorkflowCandidate | null>;
  validateIntegrity(
    state: EpisodeState,
    selection: TurnSelection,
    candidate: WorkflowCandidate,
    tracingContext?: TracingContext
  ): Promise<string | null>;
  validateRepetition(
    state: EpisodeState,
    selection: TurnSelection,
    candidate: WorkflowCandidate
  ): Promise<string | null>;
  validateFinalCandidate?(
    state: EpisodeState,
    selection: TurnSelection,
    candidate: WorkflowCandidate
  ): Promise<string | null>;
  persistCandidate(
    state: EpisodeState,
    selection: TurnSelection,
    candidate: WorkflowCandidate,
    idempotencyKey: string
  ): Promise<PersistedTurn>;
  /**
   * Projects already-accepted workflow truth back into the domain model.
   * This runs only after TURN_ACCEPTED has been reduced.
   */
  acceptCandidate?(
    state: EpisodeState,
    selection: TurnSelection,
    candidate: WorkflowCandidate,
    persisted: PersistedTurn
  ): Promise<void>;
  selectInterjection?(
    state: EpisodeState,
    acceptedSpeechId: string
  ): Promise<TurnSelection | null>;
  isNaturallyComplete?(
    state: EpisodeState,
    tracingContext?: TracingContext
  ): Promise<boolean>;
}

function apply(state: EpisodeState, event: EpisodeEvent): EpisodeState {
  return reduceEpisode(state, event);
}

function timestamp(): string {
  return new Date().toISOString();
}

function clearTurn(
  envelope: EpisodeWorkflowEnvelope,
  updates: Partial<EpisodeWorkflowEnvelope> = {}
): EpisodeWorkflowEnvelope {
  return {
    ...envelope,
    inspection: null,
    selection: null,
    candidate: null,
    review: null,
    rejectionReason: null,
    accepted: null,
    ...updates,
  };
}

export function createTurnTransactionWorkflow(
  id: string,
  dependencies: EpisodeWorkflowDependencies,
  traceSink: TraceSink
) {
  const direct = createStep({
    id: `${id}-direct`,
    inputSchema: EpisodeWorkflowEnvelopeSchema,
    outputSchema: EpisodeWorkflowEnvelopeSchema,
    execute: async ({ inputData }) => {
      const selection = inputData.selection;
      if (!selection) return inputData;
      let state = inputData.state;
      if (
        selection.isClosingTurn &&
        state.phase === "discussion" &&
        !state.terminationRequested
      ) {
        state = apply(state, {
          type: "CLOSING_REQUESTED",
          timestamp: timestamp(),
          reason: "final turn selected",
        });
      }
      const idempotencyKey = turnIdempotencyKey(
        state.episodeId,
        state.workflowRunId,
        selection.logicalTurn,
        selection.kind
      );
      state = apply(
        state,
        selection.kind === "interjection"
          ? {
              type: "INTERJECTION_REQUESTED",
              timestamp: timestamp(),
              speakerId: selection.speakerId,
              direction: selection.direction,
              logicalTurn: selection.logicalTurn,
              idempotencyKey,
            }
          : {
              type: "TURN_DIRECTED",
              timestamp: timestamp(),
              speakerId: selection.speakerId,
              direction: selection.direction,
              kind: "speech",
              logicalTurn: selection.logicalTurn,
              idempotencyKey,
            }
      );
      return { ...inputData, state };
    },
  });

  const generate = createStep({
    id: `${id}-generate`,
    inputSchema: EpisodeWorkflowEnvelopeSchema,
    outputSchema: EpisodeWorkflowEnvelopeSchema,
    retries: 2,
    execute: async ({ inputData, tracingContext }) => {
      if (!inputData.selection) return inputData;
      const candidate = await dependencies.generateCandidate(
        inputData.state,
        inputData.selection,
        tracingContext
      );
      const state = apply(inputData.state, {
        type: "TURN_GENERATED",
        timestamp: timestamp(),
        message: candidate.message,
        stopReason: candidate.stopReason,
      });
      return { ...inputData, state, candidate };
    },
  });

  const review = createStep({
    id: `${id}-review`,
    inputSchema: EpisodeWorkflowEnvelopeSchema,
    outputSchema: EpisodeWorkflowEnvelopeSchema,
    retries: 1,
    execute: async ({ inputData, tracingContext }) => {
      if (!inputData.selection || !inputData.candidate) return inputData;
      let reviewResult: WorkflowReviewResult;
      try {
        reviewResult = await dependencies.reviewCandidate(
          inputData.state,
          inputData.selection,
          inputData.candidate,
          tracingContext
        );
      } catch {
        reviewResult = {
          approved: true,
          notes: "Reviewer unavailable; accepted fail-open",
        };
      }
      const reviewedCandidate = reviewResult.candidate ?? inputData.candidate;
      const review: WorkflowReview = {
        approved: reviewResult.approved,
        notes: reviewResult.notes,
      };
      let state = inputData.state;
      if (reviewedCandidate.message !== inputData.candidate.message) {
        // The existing DirectorAgent can revise internally. Express that
        // rewrite as reducer events so pending state and durable speech agree.
        state = apply(state, {
          type: "TURN_REVIEWED",
          timestamp: timestamp(),
          approved: false,
          notes: review.notes || "Reviewer supplied a revision",
        });
        state = apply(state, {
          type: "TURN_REVISED",
          timestamp: timestamp(),
          message: reviewedCandidate.message,
          stopReason: reviewedCandidate.stopReason,
        });
      }
      state = apply(state, {
        type: "TURN_REVIEWED",
        timestamp: timestamp(),
        ...review,
      });
      return { ...inputData, state, candidate: reviewedCandidate, review };
    },
  });

  const revise = createStep({
    id: `${id}-revise`,
    inputSchema: EpisodeWorkflowEnvelopeSchema,
    outputSchema: EpisodeWorkflowEnvelopeSchema,
    retries: 1,
    execute: async ({ inputData }) => {
      const { selection, candidate, review: reviewResult } = inputData;
      if (
        !dependencies.reviseCandidate ||
        !selection ||
        !candidate ||
        !reviewResult ||
        reviewResult.approved
      ) {
        return inputData;
      }
      const revised = await dependencies.reviseCandidate(
        inputData.state,
        selection,
        candidate,
        reviewResult
      );
      if (!revised) return inputData;
      const state = apply(inputData.state, {
        type: "TURN_REVISED",
        timestamp: timestamp(),
        message: revised.message,
        stopReason: revised.stopReason,
      });
      await traceSink.export({
        episodeId: state.episodeId,
        runId: state.workflowRunId,
        flowVersion: EPISODE_FLOW_VERSION,
        modelTask: ModelTask.TurnReview,
        logicalTurn: selection.logicalTurn,
        retryCount: 0,
        latencyMs: 0,
        tokenUsage: revised.tokenUsage,
        outcome: "repaired",
      });
      return { ...inputData, state, candidate: revised, review: null };
    },
  });

  const reReview = createStep({
    id: `${id}-re-review`,
    inputSchema: EpisodeWorkflowEnvelopeSchema,
    outputSchema: EpisodeWorkflowEnvelopeSchema,
    retries: 1,
    execute: async ({ inputData, tracingContext }) => {
      if (
        !inputData.selection ||
        !inputData.candidate ||
        inputData.review !== null
      ) {
        return inputData;
      }
      let reviewResult: TurnReviewResult;
      try {
        reviewResult = await dependencies.reviewCandidate(
          inputData.state,
          inputData.selection,
          inputData.candidate,
          tracingContext
        );
      } catch {
        reviewResult = {
          approved: true,
          notes: "Reviewer unavailable after revision; accepted fail-open",
        };
      }
      const state = apply(inputData.state, {
        type: "TURN_REVIEWED",
        timestamp: timestamp(),
        ...reviewResult,
      });
      return { ...inputData, state, review: reviewResult };
    },
  });

  const validate = createStep({
    id: `${id}-validate`,
    inputSchema: EpisodeWorkflowEnvelopeSchema,
    outputSchema: EpisodeWorkflowEnvelopeSchema,
    execute: async ({ inputData, tracingContext }) => {
      const { selection, candidate, review: reviewResult } = inputData;
      if (!selection || !candidate || !reviewResult) return inputData;
      const rejectionReason =
        (!reviewResult.approved &&
          (reviewResult.notes || "Editorial review rejected the candidate")) ||
        (selection.isFinalTurn &&
          (await dependencies.validateFinalCandidate?.(
            inputData.state,
            selection,
            candidate
          ))) ||
        (await dependencies.validateIntegrity(
          inputData.state,
          selection,
          candidate,
          tracingContext
        )) ||
        (await dependencies.validateRepetition(
          inputData.state,
          selection,
          candidate
        ));
      if (!rejectionReason) return inputData;
      const state = apply(inputData.state, {
        type: "TURN_REJECTED",
        timestamp: timestamp(),
        reason: rejectionReason,
      });
      await traceSink.export({
        episodeId: state.episodeId,
        runId: state.workflowRunId,
        flowVersion: EPISODE_FLOW_VERSION,
        modelTask: selection.modelTask,
        logicalTurn: selection.logicalTurn,
        retryCount: 0,
        latencyMs: 0,
        tokenUsage: candidate.tokenUsage,
        outcome: "failed",
        attributes: { rejectionReason },
      });
      return { ...inputData, state, rejectionReason, accepted: false };
    },
  });

  const persistAndAccept = createStep({
    id: `${id}-persist`,
    inputSchema: EpisodeWorkflowEnvelopeSchema,
    outputSchema: EpisodeWorkflowEnvelopeSchema,
    retries: 2,
    execute: async ({ inputData }) => {
      const { selection, candidate } = inputData;
      if (
        !selection ||
        !candidate ||
        inputData.rejectionReason ||
        inputData.accepted === false
      ) {
        return inputData;
      }
      const idempotencyKey =
        inputData.state.pendingTurn?.idempotencyKey ??
        turnIdempotencyKey(
          inputData.state.episodeId,
          inputData.state.workflowRunId,
          selection.logicalTurn,
          selection.kind
        );
      const startedAt = Date.now();
      const persisted = await dependencies.persistCandidate(
        inputData.state,
        selection,
        candidate,
        idempotencyKey
      );
      let state = apply(inputData.state, {
        type: "TURN_ACCEPTED",
        timestamp: timestamp(),
        speechId: persisted.speechId,
        durationSeconds: persisted.durationSeconds,
        coveredDiscussionPointIds:
          persisted.coveredDiscussionPointIds ?? [],
        coveredConversationBeatIds:
          persisted.coveredConversationBeatIds ?? [],
        introducedKnowledgeIds: persisted.introducedKnowledgeIds ?? [],
        introducedTerms: persisted.introducedTerms ?? [],
        establishedDiscourseClaimIds:
          persisted.establishedDiscourseClaimIds ?? [],
        teasedDiscourseClaimIds: persisted.teasedDiscourseClaimIds ?? [],
      });
      await dependencies.acceptCandidate?.(
        state,
        selection,
        candidate,
        persisted
      );
      if (selection.isOpeningTurn) {
        state = apply(state, {
          type: "OPENING_ADVANCED",
          timestamp: timestamp(),
          isFinalOpeningTurn: selection.isFinalOpeningTurn,
        });
      }
      if (selection.isClosingTurn && state.phase === "closing") {
        state = apply(state, {
          type: "CLOSING_ADVANCED",
          timestamp: timestamp(),
          isFinalClosingTurn: selection.isFinalClosingTurn,
        });
      }
      if (selection.isFinalClosingTurn && state.phase === "closing") {
        state = apply(state, {
          type: "EPISODE_COMPLETED",
          timestamp: timestamp(),
        });
      }
      await traceSink.export({
        episodeId: state.episodeId,
        runId: state.workflowRunId,
        flowVersion: EPISODE_FLOW_VERSION,
        modelTask: selection.modelTask,
        logicalTurn: selection.logicalTurn,
        retryCount: 0,
        latencyMs: Date.now() - startedAt,
        tokenUsage: candidate.tokenUsage,
        outcome: "completed",
        acceptedSpeechId: persisted.speechId,
      });
      return {
        ...inputData,
        state,
        accepted: true,
        lastAcceptedSpeechId: persisted.speechId,
        lastTurnWasOpening: selection.isOpeningTurn,
        lastTurnWasFinal: selection.isFinalClosingTurn,
      };
    },
  });

  const finish = createStep({
    id: `${id}-finish`,
    inputSchema: EpisodeWorkflowEnvelopeSchema,
    outputSchema: EpisodeWorkflowEnvelopeSchema,
    execute: async ({ inputData }) =>
      inputData.selection
        ? clearTurn(inputData, { iteration: inputData.iteration + 1 })
        : inputData,
  });

  return createWorkflow({
    id,
    inputSchema: EpisodeWorkflowEnvelopeSchema,
    outputSchema: EpisodeWorkflowEnvelopeSchema,
    options: { shouldPersistSnapshot: () => true },
  })
    .then(direct)
    .then(generate)
    .then(review)
    .then(revise)
    .then(reReview)
    .then(validate)
    .then(persistAndAccept)
    .then(finish)
    .commit();
}

export function createEpisodeWorkflow(
  dependencies: EpisodeWorkflowDependencies,
  traceSink: TraceSink
) {
  const speechTransaction = createTurnTransactionWorkflow(
    "produce-speech",
    dependencies,
    traceSink
  );
  const interjectionTransaction = createTurnTransactionWorkflow(
    "produce-interjection",
    dependencies,
    traceSink
  );

  const inspectEpisode = createStep({
    id: "inspect-episode",
    inputSchema: EpisodeWorkflowEnvelopeSchema,
    outputSchema: EpisodeWorkflowEnvelopeSchema,
    execute: async ({ inputData }) => {
      if (inputData.state.phase === "completed") return inputData;
      const inspection = await dependencies.inspectEpisode(inputData.state);
      return {
        ...clearTurn(inputData, { lastAcceptedSpeechId: null }),
        lastTurnWasOpening: false,
        lastTurnWasFinal: false,
        inspection,
      };
    },
  });

  const proposeTurn = createStep({
    id: "propose-turn",
    inputSchema: EpisodeWorkflowEnvelopeSchema,
    outputSchema: EpisodeWorkflowEnvelopeSchema,
    execute: async ({ inputData, tracingContext }) => {
      if (inputData.state.phase === "completed") return inputData;
      if (
        inputData.state.phase === "opening" &&
        inputData.state.consecutiveRejectedTurns >= 5
      ) {
        throw new Error(
          `Logical turn rejected ${inputData.state.consecutiveRejectedTurns} consecutive times`
        );
      }
      const hitTurnLimit =
        inputData.state.turnsUsed >= inputData.limits.maxTurns;
      const hitDurationLimit =
        inputData.state.elapsedDurationEstimateSeconds >=
        inputData.limits.maxDurationSeconds;
      const hitIterationLimit =
        inputData.iteration >= inputData.limits.maxIterations - 1;
      const orientationActive =
        inputData.inspection?.orientationActive === true;
      let selection: TurnSelection;
      if (
        inputData.state.phase !== "opening" &&
        !orientationActive &&
        (hitTurnLimit || hitDurationLimit || hitIterationLimit)
      ) {
        const reason = hitTurnLimit
          ? "turn limit"
          : hitDurationLimit
            ? "duration limit"
            : "workflow iteration limit";
        selection = await dependencies.forceClosingTurn(
          inputData.state,
          reason
        );
      } else if (inputData.state.phase === "closing") {
        selection = await dependencies.forceClosingTurn(
          inputData.state,
          "closing phase"
        );
      } else {
        try {
          const naturallyComplete =
            inputData.state.phase === "discussion" &&
            (await dependencies.isNaturallyComplete?.(
              inputData.state,
              tracingContext
            ));
          selection = naturallyComplete
            ? await dependencies.forceClosingTurn(
                inputData.state,
                "natural conclusion"
              )
            : await dependencies.proposeTurn(
                inputData.state,
                inputData.inspection ?? {},
                tracingContext
              );
          if (
            inputData.state.phase === "discussion" &&
            selection.isFinalTurn &&
            !selection.isClosingTurn
          ) {
            selection = await dependencies.forceClosingTurn(
              inputData.state,
              "director requested close"
            );
          }
        } catch {
          selection = await dependencies.forceClosingTurn(
            inputData.state,
            "turn selection failed"
          );
        }
      }
      if (
        inputData.state.phase === "opening" &&
        selection.isFinalTurn
      ) {
        selection = {
          ...selection,
          isOpeningTurn: true,
          isFinalOpeningTurn: true,
        };
      }
      await traceSink.export({
        episodeId: inputData.state.episodeId,
        runId: inputData.state.workflowRunId,
        flowVersion: EPISODE_FLOW_VERSION,
        modelTask: ModelTask.DirectionSelection,
        logicalTurn: selection.logicalTurn,
        retryCount: 0,
        latencyMs: 0,
        outcome: "proposed",
      });
      return { ...inputData, selection };
    },
  });

  const repairTurn = createStep({
    id: "repair-turn",
    inputSchema: EpisodeWorkflowEnvelopeSchema,
    outputSchema: EpisodeWorkflowEnvelopeSchema,
    execute: async ({ inputData }) => {
      if (!inputData.selection) return inputData;
      const repaired = await dependencies.repairTurn(
        inputData.state,
        inputData.selection,
        inputData.inspection ?? {}
      );
      if (repaired.wasRepaired) {
        await traceSink.export({
          episodeId: inputData.state.episodeId,
          runId: inputData.state.workflowRunId,
          flowVersion: EPISODE_FLOW_VERSION,
          modelTask: ModelTask.DirectionSelection,
          logicalTurn: repaired.logicalTurn,
          retryCount: 0,
          latencyMs: 0,
          outcome: "repaired",
        });
      }
      return { ...inputData, selection: repaired };
    },
  });

  const selectInterjection = createStep({
    id: "select-interjection",
    inputSchema: EpisodeWorkflowEnvelopeSchema,
    outputSchema: EpisodeWorkflowEnvelopeSchema,
    execute: async ({ inputData }) => {
      if (
        !dependencies.selectInterjection ||
        !inputData.lastAcceptedSpeechId ||
        inputData.lastTurnWasOpening ||
        inputData.lastTurnWasFinal ||
        inputData.state.phase !== "discussion"
      ) {
        return clearTurn(inputData);
      }
      const selection = await dependencies.selectInterjection(
        inputData.state,
        inputData.lastAcceptedSpeechId
      );
      return {
        ...clearTurn(inputData),
        selection: selection
          ? { ...selection, kind: "interjection" as const }
          : null,
      };
    },
  });

  const oneIteration = createWorkflow({
    id: "produce-episode-turn",
    inputSchema: EpisodeWorkflowEnvelopeSchema,
    outputSchema: EpisodeWorkflowEnvelopeSchema,
    options: { shouldPersistSnapshot: () => true },
  })
    .then(inspectEpisode)
    .then(proposeTurn)
    .then(repairTurn)
    .then(speechTransaction)
    .then(selectInterjection)
    .then(interjectionTransaction)
    .commit();

  const initialise = createStep({
    id: "initialise-episode",
    inputSchema: EpisodeWorkflowInputSchema,
    outputSchema: EpisodeWorkflowEnvelopeSchema,
    execute: async ({ inputData }) => {
      let state = createInitialEpisodeState(inputData.definition);
      state = apply(state, {
        type: "EPISODE_INITIALISED",
        timestamp: timestamp(),
      });
      return {
        state,
        speakerIds: inputData.definition.speakerIds,
        limits: {
          maxTurns: inputData.maxTurns,
          maxDurationSeconds: inputData.maxDurationSeconds,
          maxIterations:
            inputData.maxTurns * 3 +
            inputData.definition.speakerIds.length +
            10,
        },
        iteration: 0,
        inspection: null,
        selection: null,
        candidate: null,
        review: null,
        rejectionReason: null,
        accepted: null,
        lastAcceptedSpeechId: null,
        lastTurnWasOpening: false,
        lastTurnWasFinal: false,
      };
    },
  });

  const prepareMaterials = createStep({
    id: "prepare-materials",
    inputSchema: EpisodeWorkflowEnvelopeSchema,
    outputSchema: EpisodeWorkflowEnvelopeSchema,
    retries: 2,
    execute: async ({ inputData }) => {
      let state = inputData.state;
      try {
        await dependencies.prepareMaterials(state.episodeId);
        state = apply(state, {
          type: "MATERIALS_PREPARED",
          timestamp: timestamp(),
        });
      } catch (error) {
        state = apply(state, {
          type: "WORKFLOW_WARNING_RECORDED",
          timestamp: timestamp(),
          message: `Material preparation failed: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        });
      }
      return { ...inputData, state };
    },
  });

  const assignRoles = createStep({
    id: "assign-roles",
    inputSchema: EpisodeWorkflowEnvelopeSchema,
    outputSchema: EpisodeWorkflowEnvelopeSchema,
    retries: 2,
    execute: async ({ inputData, tracingContext }) => {
      const assignments = await dependencies.assignSpeakerRoles(
        inputData.state.episodeId,
        inputData.speakerIds,
        tracingContext
      );
      const state = apply(inputData.state, {
        type: "ROLES_ASSIGNED",
        timestamp: timestamp(),
        assignments,
      });
      return { ...inputData, state };
    },
  });

  const createPlan = createStep({
    id: "create-plan",
    inputSchema: EpisodeWorkflowEnvelopeSchema,
    outputSchema: EpisodeWorkflowEnvelopeSchema,
    retries: 2,
    execute: async ({ inputData, tracingContext }) => {
      const plan = await dependencies.createPlan(
        inputData.state.episodeId,
        tracingContext
      );
      const state = apply(inputData.state, {
        type: "PLAN_CREATED",
        timestamp: timestamp(),
        discussionPointIds: plan.discussionPointIds,
        conversationBeatIds: plan.conversationBeatIds,
        discourseClaimIds: plan.discourseClaimIds,
      });
      return { ...inputData, state };
    },
  });

  const forceComplete = createStep({
    id: "force-complete-if-needed",
    inputSchema: EpisodeWorkflowEnvelopeSchema,
    outputSchema: EpisodeWorkflowOutputSchema,
    execute: async ({ inputData }) => {
      let state = inputData.state;
      if (state.phase !== "completed") {
        if (state.pendingTurn) {
          state = apply(state, {
            type: "TURN_REJECTED",
            timestamp: timestamp(),
            reason: "Workflow iteration bound reached",
          });
        }
        if (state.phase === "opening") {
          // A forced close during an incomplete opening transitions through a
          // compact synthetic opening advance; accepted dialogue is untouched.
          state = apply(state, {
            type: "OPENING_ADVANCED",
            timestamp: timestamp(),
            isFinalOpeningTurn: true,
          });
        }
        if (state.phase === "discussion") {
          state = apply(state, {
            type: "CLOSING_REQUESTED",
            timestamp: timestamp(),
            reason: "workflow iteration bound reached",
          });
        }
        if (state.phase === "closing") {
          state = apply(state, {
            type: "WORKFLOW_WARNING_RECORDED",
            timestamp: timestamp(),
            message:
              "Workflow iteration bound reached before a valid closing statement was accepted",
          });
        }
      }
      return {
        state,
        episodeId: state.episodeId,
        runId: state.workflowRunId,
        flowVersion: EPISODE_FLOW_VERSION as typeof EPISODE_FLOW_VERSION,
      };
    },
  });

  return createWorkflow({
    id: "generate-episode",
    inputSchema: EpisodeWorkflowInputSchema,
    outputSchema: EpisodeWorkflowOutputSchema,
    options: { shouldPersistSnapshot: () => true },
  })
    .then(initialise)
    .then(prepareMaterials)
    .then(assignRoles)
    .then(createPlan)
    .dowhile(
      oneIteration,
      async ({ inputData }) =>
        inputData.state.phase !== "completed" &&
        inputData.iteration < inputData.limits.maxIterations
    )
    .then(forceComplete)
    .commit();
}
