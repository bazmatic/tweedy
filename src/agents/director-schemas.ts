import { z } from "zod";
import {
  AudienceValue,
  BeatPurpose,
  ConversationalDevice,
  EditorialMove,
  EnergyLevel,
  Speaker,
} from "../types";

export const conversationBeatSchema = z.object({
  purpose: z
    .nativeEnum(BeatPurpose)
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
    .describe("The desired energy level for the beat."),
  targetTurns: z
    .number()
    .optional()
    .describe("A realistic number of speaking turns for the beat."),
});

export type ConversationBeatInput = z.infer<typeof conversationBeatSchema>;

export const createPodcastPlanSchema = z
  .object({
    points: z
      .array(z.string())
      .describe(
        "Concrete, discrete discussion points that must be covered, each expressed as a short phrase."
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
        .describe(
          "Clear, specific, conversational direction for what this speaker should say next."
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
      move: z
        .nativeEnum(EditorialMove)
        .optional()
        .describe("The subject-neutral editorial move for this turn."),
      cardIds: z
        .array(z.string())
        .optional()
        .describe("Prepared editorial card ids relevant to this turn."),
      audienceValue: z
        .nativeEnum(AudienceValue)
        .optional()
        .describe("The primary value this turn gives the audience."),
      desiredEnergy: z
        .nativeEnum(EnergyLevel)
        .optional()
        .describe("The desired energy level for this turn."),
      device: z
        .nativeEnum(ConversationalDevice)
        .optional()
        .describe(
          "An optional conversational device, only when it fits naturally."
        ),
    })
    .describe("The selected speaker and editorial direction for the next turn.");
}

export type SelectNextSpeakerInput = z.infer<
  ReturnType<typeof createSelectNextSpeakerSchema>
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
