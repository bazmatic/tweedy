import { z } from "zod";
import { PendingTurnKindSchema, StopReasonSchema } from "./episode-schemas";

export const EpisodeInitialisedEventSchema = z.object({
  type: z.literal("EPISODE_INITIALISED"),
  timestamp: z.string(),
});
export type EpisodeInitialisedEvent = z.infer<typeof EpisodeInitialisedEventSchema>;

export const MaterialsPreparedEventSchema = z.object({
  type: z.literal("MATERIALS_PREPARED"),
  timestamp: z.string(),
});
export type MaterialsPreparedEvent = z.infer<typeof MaterialsPreparedEventSchema>;

export const RolesAssignedEventSchema = z.object({
  type: z.literal("ROLES_ASSIGNED"),
  timestamp: z.string(),
  assignments: z.record(z.string(), z.string()),
});
export type RolesAssignedEvent = z.infer<typeof RolesAssignedEventSchema>;

export const PlanCreatedEventSchema = z.object({
  type: z.literal("PLAN_CREATED"),
  timestamp: z.string(),
});
export type PlanCreatedEvent = z.infer<typeof PlanCreatedEventSchema>;

export const OpeningAdvancedEventSchema = z.object({
  type: z.literal("OPENING_ADVANCED"),
  timestamp: z.string(),
  isFinalOpeningTurn: z.boolean(),
});
export type OpeningAdvancedEvent = z.infer<typeof OpeningAdvancedEventSchema>;

export const TurnDirectedEventSchema = z.object({
  type: z.literal("TURN_DIRECTED"),
  timestamp: z.string(),
  speakerId: z.string(),
  direction: z.string(),
  kind: PendingTurnKindSchema,
  logicalTurn: z.number().int().nonnegative().optional(),
  idempotencyKey: z.string().min(1).optional(),
});
export type TurnDirectedEvent = z.infer<typeof TurnDirectedEventSchema>;

export const TurnGeneratedEventSchema = z.object({
  type: z.literal("TURN_GENERATED"),
  timestamp: z.string(),
  message: z.string(),
  stopReason: StopReasonSchema,
});
export type TurnGeneratedEvent = z.infer<typeof TurnGeneratedEventSchema>;

export const TurnReviewedEventSchema = z.object({
  type: z.literal("TURN_REVIEWED"),
  timestamp: z.string(),
  approved: z.boolean(),
  notes: z.string(),
});
export type TurnReviewedEvent = z.infer<typeof TurnReviewedEventSchema>;

export const TurnRejectedEventSchema = z.object({
  type: z.literal("TURN_REJECTED"),
  timestamp: z.string(),
  reason: z.string(),
});
export type TurnRejectedEvent = z.infer<typeof TurnRejectedEventSchema>;

export const TurnAcceptedEventSchema = z.object({
  type: z.literal("TURN_ACCEPTED"),
  timestamp: z.string(),
  speechId: z.string(),
  durationSeconds: z.number().nonnegative(),
  coveredDiscussionPointIds: z.array(z.string()),
  coveredConversationBeatIds: z.array(z.string()),
  introducedKnowledgeIds: z.array(z.string()).optional(),
  introducedTerms: z.array(z.string()).optional(),
});
export type TurnAcceptedEvent = z.infer<typeof TurnAcceptedEventSchema>;

export const InterjectionRequestedEventSchema = z.object({
  type: z.literal("INTERJECTION_REQUESTED"),
  timestamp: z.string(),
  speakerId: z.string(),
  direction: z.string(),
  logicalTurn: z.number().int().nonnegative().optional(),
  idempotencyKey: z.string().min(1).optional(),
});
export type InterjectionRequestedEvent = z.infer<typeof InterjectionRequestedEventSchema>;

export const ClosingRequestedEventSchema = z.object({
  type: z.literal("CLOSING_REQUESTED"),
  timestamp: z.string(),
  reason: z.string(),
});
export type ClosingRequestedEvent = z.infer<typeof ClosingRequestedEventSchema>;

export const EpisodeCompletedEventSchema = z.object({
  type: z.literal("EPISODE_COMPLETED"),
  timestamp: z.string(),
});
export type EpisodeCompletedEvent = z.infer<typeof EpisodeCompletedEventSchema>;

export const WorkflowWarningRecordedEventSchema = z.object({
  type: z.literal("WORKFLOW_WARNING_RECORDED"),
  timestamp: z.string(),
  message: z.string(),
});
export type WorkflowWarningRecordedEvent = z.infer<typeof WorkflowWarningRecordedEventSchema>;

export const EpisodeEventSchema = z.discriminatedUnion("type", [
  EpisodeInitialisedEventSchema,
  MaterialsPreparedEventSchema,
  RolesAssignedEventSchema,
  PlanCreatedEventSchema,
  OpeningAdvancedEventSchema,
  TurnDirectedEventSchema,
  TurnGeneratedEventSchema,
  TurnReviewedEventSchema,
  TurnRejectedEventSchema,
  TurnAcceptedEventSchema,
  InterjectionRequestedEventSchema,
  ClosingRequestedEventSchema,
  EpisodeCompletedEventSchema,
  WorkflowWarningRecordedEventSchema,
]);
export type EpisodeEvent = z.infer<typeof EpisodeEventSchema>;

export const EPISODE_EVENT_TYPES = EpisodeEventSchema.options.map(
  (option) => option.shape.type.value
) as EpisodeEvent["type"][];
