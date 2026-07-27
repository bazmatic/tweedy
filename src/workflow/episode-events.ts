import { z } from "zod";
import { PendingTurnKindSchema, StopReasonSchema } from "./episode-schemas";

const EpisodeInitialisedEventSchema = z.object({
  type: z.literal("EPISODE_INITIALISED"),
  timestamp: z.string(),
});

const MaterialsPreparedEventSchema = z.object({
  type: z.literal("MATERIALS_PREPARED"),
  timestamp: z.string(),
});

const RolesAssignedEventSchema = z.object({
  type: z.literal("ROLES_ASSIGNED"),
  timestamp: z.string(),
  assignments: z.record(z.string(), z.string()),
});

const PlanCreatedEventSchema = z.object({
  type: z.literal("PLAN_CREATED"),
  timestamp: z.string(),
});

const OpeningAdvancedEventSchema = z.object({
  type: z.literal("OPENING_ADVANCED"),
  timestamp: z.string(),
  isFinalOpeningTurn: z.boolean(),
});

const TurnDirectedEventSchema = z.object({
  type: z.literal("TURN_DIRECTED"),
  timestamp: z.string(),
  speakerId: z.string(),
  direction: z.string(),
  kind: PendingTurnKindSchema,
});

const TurnGeneratedEventSchema = z.object({
  type: z.literal("TURN_GENERATED"),
  timestamp: z.string(),
  message: z.string(),
  stopReason: StopReasonSchema,
});

const TurnReviewedEventSchema = z.object({
  type: z.literal("TURN_REVIEWED"),
  timestamp: z.string(),
  approved: z.boolean(),
  notes: z.string(),
});

const TurnRejectedEventSchema = z.object({
  type: z.literal("TURN_REJECTED"),
  timestamp: z.string(),
  reason: z.string(),
});

const TurnAcceptedEventSchema = z.object({
  type: z.literal("TURN_ACCEPTED"),
  timestamp: z.string(),
  speechId: z.string(),
  durationSeconds: z.number().nonnegative(),
  coveredDiscussionPointIds: z.array(z.string()),
  coveredConversationBeatIds: z.array(z.string()),
});

const InterjectionRequestedEventSchema = z.object({
  type: z.literal("INTERJECTION_REQUESTED"),
  timestamp: z.string(),
  speakerId: z.string(),
  direction: z.string(),
});

const ClosingRequestedEventSchema = z.object({
  type: z.literal("CLOSING_REQUESTED"),
  timestamp: z.string(),
  reason: z.string(),
});

const EpisodeCompletedEventSchema = z.object({
  type: z.literal("EPISODE_COMPLETED"),
  timestamp: z.string(),
});

const WorkflowWarningRecordedEventSchema = z.object({
  type: z.literal("WORKFLOW_WARNING_RECORDED"),
  timestamp: z.string(),
  message: z.string(),
});

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
