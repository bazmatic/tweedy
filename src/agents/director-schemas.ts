import { z } from "zod";
import {
  AudienceValue,
  BeatPurpose,
  ConversationalDevice,
  DiscussionPointPriority,
  EditorialMove,
  EnergyLevel,
  EpistemicRole,
  Speaker,
} from "../types";
import { logger } from "../utils/logger";

/**
 * Logs and falls back when the model returns an enum field that doesn't
 * match any known value, instead of silently swallowing the mismatch.
 */
function fallbackWithWarning<T>(field: string, fallback: T) {
  return (ctx: { input: unknown }) => {
    if (ctx.input !== undefined) {
      logger.warn(
        `Director schema: "${field}" received unrecognised value ${JSON.stringify(
          ctx.input
        )}, falling back to ${JSON.stringify(fallback)}`
      );
    }
    return fallback;
  };
}

const discourseClaimSchema = z.object({
  text: z.string().describe("One atomic meaning the listener must understand."),
  role: z
    .string()
    .min(1)
    .describe(
      "A concise subject-neutral discourse role. Prefer context, proposition, action, mechanism, explanation, evidence, example, surprise, complication, implication, or payoff; other labels are accepted and matched semantically."
    ),
  prerequisiteClaimIndexes: z
    .array(z.number().int().nonnegative())
    .optional()
    .describe(
      "Zero-based indexes of earlier claims in this same beat that listeners must understand first."
    ),
});

export const conversationBeatSchema = z.object({
  purpose: z
    .nativeEnum(BeatPurpose)
    .catch(fallbackWithWarning("purpose", BeatPurpose.Explore))
    .describe("The listener-centred purpose of this conversation beat."),
  goal: z.string().describe("What this beat should achieve for the listener."),
  cardIds: z
    .array(z.string())
    .optional()
    .describe("Prepared editorial card ids useful for this beat."),
  prerequisiteBeatIds: z
    .array(z.string())
    .optional()
    .describe("Conversation beat ids that should be completed first."),
  desiredEnergy: z
    .nativeEnum(EnergyLevel)
    .optional()
    .catch(fallbackWithWarning("desiredEnergy", EnergyLevel.Curious))
    .describe("The desired energy level for the beat."),
  targetTurns: z
    .number()
    .optional()
    .describe("A realistic number of speaking turns for the beat."),
  pointIds: z
    .array(z.string())
    .optional()
    .describe(
      "Discussion point ids this beat advances, using the point order as p1, p2, and so on."
    ),
  claims: z
    .array(discourseClaimSchema)
    .min(1)
    .max(8)
    .optional()
    .describe(
      "Ordered atomic claims for this beat. Context and propositions must precede dependent evidence, complications, implications, and payoffs."
    ),
});

export type ConversationBeatInput = z.infer<typeof conversationBeatSchema>;

const rankedDiscussionPointSchema = z.object({
  text: z.string().describe("A short, concrete discussion point."),
  priority: z
    .nativeEnum(DiscussionPointPriority)
    .describe("How important this point is to the episode's central promise."),
  storyValue: z
    .number()
    .min(1)
    .max(10)
    .describe("How compelling or memorable this point is likely to sound."),
  estimatedTurns: z
    .number()
    .int()
    .min(1)
    .max(6)
    .describe("Substantive speaking turns needed to cover it naturally."),
  prerequisiteClaimIds: z
    .array(z.string())
    .optional()
    .describe(
      "Orientation claim ids that listeners must understand before this point is eligible."
    ),
});

const orientationContractSchema = z.object({
  subject: z.string().describe("The thing, question, person, event, or idea being discussed."),
  scope: z.string().describe("The specific aspect and boundaries of the episode."),
  centralQuestion: z.string().describe("The organising listener-facing question."),
  requiredClaims: z
    .array(z.string())
    .min(2)
    .max(6)
    .describe(
      "Atomic, domain-neutral facts a new listener must understand before deeper discussion. They receive ids o1, o2, and so on in this order."
    ),
  maxTurns: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Suggested orientation turn budget. Runtime policy safely clamps this to its supported range."
    ),
});

export const createPodcastPlanSchema = z
  .object({
    points: z
      .array(z.union([z.string(), rankedDiscussionPointSchema]))
      .describe(
        "Ranked editorial opportunities. Prefer objects with text, priority, storyValue and estimatedTurns; plain strings remain accepted for compatibility."
      ),
    narrative: z
      .string()
      .describe(
        "A detailed prose description of how the conversation should flow from opening to closing."
      ),
    beats: z
      .array(conversationBeatSchema)
      .optional()
      .describe(
        "A listener-centred sequence balancing understanding, entertainment, insight and conversational momentum."
      ),
    centralAnalogy: z
      .string()
      .optional()
      .describe(
        "One concrete, physical, everyday analogy for the episode's core concept (e.g. 'programs are public library terminals; accounts are USB drives you bring'). Both speakers will reuse and extend this analogy throughout the episode, so make it extensible."
      ),
    orientation: orientationContractSchema
      .optional()
      .describe(
        "A subject-neutral orientation contract that establishes what is being discussed before exploration."
      ),
  })
  .describe("A complete editorial plan for the podcast episode.");

export type CreatePodcastPlanInput = z.infer<
  typeof createPodcastPlanSchema
>;

export function createSelectNextSpeakerSchema(speakers: Speaker[]) {
  const availableSpeakers = speakers
    .map((speaker) => `${speaker.name} (${speaker.id})`)
    .join(", ");

  return z
    .object({
      speakerId: z
        .string()
        .describe(
          `The id or exact name of the speaker who should talk next. Available speakers: ${availableSpeakers}.`
        ),
      direction: z
        .string()
        .optional()
        .describe(
          "An optional brief goal or topic for this speaker's next turn — what they should address, not what they should say. Leave this empty when the conversation is flowing well and the speaker doesn't need steering; only give direction when it's actually needed to move things forward, close a point, or redirect. Never write out what they should say — leave wording, phrasing and angle to the speaker."
        ),
      coveredPointIds: z
        .array(z.string())
        .optional()
        .describe(
          "Ids of open discussion points explicitly and substantively discussed with specific detail, not merely mentioned in a topically adjacent way."
        ),
      coveredBeatIds: z
        .array(z.string())
        .optional()
        .describe(
          "Ids of open conversation beats genuinely completed by recent speech."
        ),
      beatId: z
        .string()
        .optional()
        .describe("The current conversation beat id, when applicable."),
      goal: z
        .string()
        .optional()
        .describe("What this turn should contribute to the listener's journey."),
      moveRationale: z
        .string()
        .optional()
        .describe(
          "One short sentence on why this specific move fits the actual conversation so far — e.g. what, concretely, is being reacted to, questioned, or reframed. Not shown to the speaker; for internal debugging only."
        ),
      move: z
        .nativeEnum(EditorialMove)
        .optional()
        .catch(fallbackWithWarning("move", EditorialMove.Explain))
        .describe("The subject-neutral editorial move for this turn."),
      cardIds: z
        .array(z.string())
        .optional()
        .describe("Prepared editorial card ids relevant to this turn."),
      audienceValue: z
        .nativeEnum(AudienceValue)
        .optional()
        .catch(fallbackWithWarning("audienceValue", AudienceValue.Understanding))
        .describe("The primary value this turn gives the audience."),
      desiredEnergy: z
        .nativeEnum(EnergyLevel)
        .optional()
        .catch(fallbackWithWarning("desiredEnergy", EnergyLevel.Curious))
        .describe("The desired energy level for this turn."),
      device: z
        .nativeEnum(ConversationalDevice)
        .optional()
        .catch(fallbackWithWarning("device", undefined))
        .describe(
          "An optional conversational device, only when it fits naturally."
        ),
    })
    .describe("The selected speaker and editorial direction for the next turn.");
}

export type SelectNextSpeakerInput = z.infer<
  ReturnType<typeof createSelectNextSpeakerSchema>
>;

export function createAssignSpeakerRolesSchema(speakers: Speaker[]) {
  const availableSpeakers = speakers
    .map((speaker) => `${speaker.name} (${speaker.id})`)
    .join(", ");

  return z
    .object({
      assignments: z
        .array(
          z.object({
            speakerId: z
              .string()
              .describe(
                `The id of the speaker being assigned a role. Available speakers: ${availableSpeakers}.`
              ),
            epistemicRole: z
              .nativeEnum(EpistemicRole)
              .catch(fallbackWithWarning("epistemicRole", EpistemicRole.AudienceGuide))
              .describe(
                "This speaker's knowledge role for this specific episode, based on their personality and the source material below — not a fixed trait of the speaker."
              ),
          })
        )
        .describe("One role assignment per speaker, for this episode only."),
    })
    .describe(
      "Runtime epistemic role assignment for each speaker, decided fresh for this episode's material."
    );
}

export type AssignSpeakerRolesInput = z.infer<
  ReturnType<typeof createAssignSpeakerRolesSchema>
>;

export const verifyCoveredPointsSchema = z
  .object({
    confirmedPointIds: z
      .array(z.string())
      .describe(
        "Ids of candidate points explicitly and substantively discussed with specific matching detail. Exclude topically adjacent or passing mentions."
      ),
  })
  .describe("Strict verification of discussion-point coverage.");

export type VerifyCoveredPointsInput = z.infer<
  typeof verifyCoveredPointsSchema
>;

export const checkConversationCompleteSchema = z
  .object({
    isComplete: z
      .boolean()
      .describe(
        "True only when the recent conversation has genuinely wrapped up naturally, not merely covered every required point."
      ),
  })
  .describe("A judgement of whether the episode has naturally concluded.");

export type CheckConversationCompleteInput = z.infer<
  typeof checkConversationCompleteSchema
>;
