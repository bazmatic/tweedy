import { z } from "zod";

export const EpisodePhaseSchema = z.enum([
  "preparing",
  "opening",
  "discussion",
  "closing",
  "completed",
  "failed",
]);
export type EpisodePhase = z.infer<typeof EpisodePhaseSchema>;

export const StopReasonSchema = z.enum(["max_tokens", "stop", "tool_use", "unknown"]);
export type StopReason = z.infer<typeof StopReasonSchema>;

export const PendingTurnKindSchema = z.enum(["speech", "interjection"]);
export type PendingTurnKind = z.infer<typeof PendingTurnKindSchema>;

export const PendingTurnSchema = z.object({
  kind: PendingTurnKindSchema,
  logicalTurn: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(1),
  speakerId: z.string(),
  direction: z.string(),
  candidateMessage: z.string().nullable(),
  candidateStopReason: StopReasonSchema.nullable(),
  reviewNotes: z.string().nullable(),
  reviewApproved: z.boolean().nullable(),
});
export type PendingTurn = z.infer<typeof PendingTurnSchema>;

export const EpisodeDefinitionSchema = z.object({
  episodeId: z.string(),
  workflowRunId: z.string(),
  discussionPointIds: z.array(z.string()),
  conversationBeatIds: z.array(z.string()),
  speakerIds: z.array(z.string()),
});
export type EpisodeDefinition = z.infer<typeof EpisodeDefinitionSchema>;

const CoveredItemSchema = z.object({ id: z.string(), covered: z.boolean() });

export const EpisodeStateSchema = z.object({
  schemaVersion: z.literal(1),
  phase: EpisodePhaseSchema,
  episodeId: z.string(),
  workflowRunId: z.string(),
  turnsUsed: z.number().int().nonnegative(),
  consecutiveRejectedTurns: z.number().int().nonnegative().default(0),
  lateStageTurns: z.number().int().nonnegative(),
  openingCursor: z.number().int().nonnegative(),
  closingCursor: z.number().int().nonnegative().default(0),
  discussionPoints: z.array(CoveredItemSchema),
  conversationBeats: z.array(CoveredItemSchema),
  discourseClaims: z.array(CoveredItemSchema).default([]),
  teasedDiscourseClaimIds: z.array(z.string()).default([]),
  speakerRoleAssignments: z.record(z.string(), z.string()),
  acceptedSpeechIds: z.array(z.string()),
  pendingTurn: PendingTurnSchema.nullable(),
  knowledgeLedger: z.array(z.string()),
  terminologyLedger: z.array(z.string()),
  elapsedDurationEstimateSeconds: z.number().nonnegative(),
  terminationRequested: z.boolean(),
  terminationReason: z.string().nullable(),
  warnings: z.array(z.string()),
  lastAppliedEvent: z.string().nullable(),
});
export type EpisodeState = z.infer<typeof EpisodeStateSchema>;

export function createInitialEpisodeState(definition: EpisodeDefinition): EpisodeState {
  return {
    schemaVersion: 1,
    phase: "preparing",
    episodeId: definition.episodeId,
    workflowRunId: definition.workflowRunId,
    turnsUsed: 0,
    consecutiveRejectedTurns: 0,
    lateStageTurns: 0,
    openingCursor: 0,
    closingCursor: 0,
    discussionPoints: definition.discussionPointIds.map((id) => ({ id, covered: false })),
    conversationBeats: definition.conversationBeatIds.map((id) => ({ id, covered: false })),
    discourseClaims: [],
    teasedDiscourseClaimIds: [],
    speakerRoleAssignments: {},
    acceptedSpeechIds: [],
    pendingTurn: null,
    knowledgeLedger: [],
    terminologyLedger: [],
    elapsedDurationEstimateSeconds: 0,
    terminationRequested: false,
    terminationReason: null,
    warnings: [],
    lastAppliedEvent: null,
  };
}
