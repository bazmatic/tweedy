// src/agents/TurnDirectionProposer.ts
import {
  AudienceValue,
  ConversationalDevice,
  DiscussionPoint,
  EditorialMove,
  EnergyLevel,
  PodcastScript,
} from "../types";
import { EpisodeInspection, CLOSING_STAGE_PROGRESS_THRESHOLD } from "../workflow/EpisodeInspector";
import {
  SelectNextSpeakerInput,
  createSelectNextSpeakerSchema,
} from "./director-schemas";
import { ModelTask } from "../providers/ModelRoutingPolicy";
import { StructuredModelCaller } from "./CoverageVerifier";
import { logger } from "../utils/logger";

const MAX_TURN_DIRECTION_TOKENS = 600;

export interface TurnProposal {
  speakerId: string;
  direction: string;
  claimedCoveredPointIds: string[];
  claimedCoveredBeatIds: string[];
  beatId?: string;
  move?: EditorialMove;
  cardIds: string[];
  audienceValue?: AudienceValue;
  desiredEnergy?: EnergyLevel;
  device?: ConversationalDevice;
  moveRationale?: string;
}

export function buildOpenPointsSection(points: DiscussionPoint[]): string {
  if (points.length === 0) {
    return "";
  }
  const openPoints = points.filter((point) => !point.covered);
  if (openPoints.length === 0) {
    return "\n\nAll discussion points have been covered.";
  }
  const list = openPoints.map((point) => `- ${point.id}: ${point.text}`).join("\n");
  return `\n\nOpen discussion points (mark any addressed by the last speech(es) via coveredPointIds):\n${list}`;
}

export function buildWrapUpNote(inspection: EpisodeInspection): string {
  if (inspection.isFinalTurn) {
    return " This is the final turn of the episode — direct this speaker to deliver a closing statement. It must step back to the episode's overall throughline or big-picture takeaway rather than recapping every point, must not raise any new fact or question, and must end by signing off naturally, not on a question. Before assigning this, confirm from the conversation above that nothing is left as an open, unanswered question — if something still is, that should already have been resolved by an earlier nearly_out_of_time turn; do not let the closing turn attempt to resolve it, and do not let it introduce something new instead.";
  }

  if (inspection.progress >= CLOSING_STAGE_PROGRESS_THRESHOLD) {
    if (inspection.hasAnnouncedTimePressure) {
      return " The speakers have already told listeners that time is running out. Keep the remaining turns concise and move directly towards the close without mentioning the time pressure again.";
    }
    return " The episode is almost out of time — direct the speakers to wrap up remaining points and head toward a close within the next turn or two, rather than opening new topics. If the immediately preceding turn(s) left a question or thread unanswered, this time-pressure turn must resolve it — answer it briefly — rather than only announcing that time is short; do not let the episode move toward closing while a live question sits unanswered.";
  }

  if (inspection.progress >= 65) {
    return " The episode is well past the halfway point of its time budget — start steering the conversation toward wrapping up open topics instead of introducing new ones.";
  }

  return "";
}

export function buildVelocityNote(
  inspection: EpisodeInspection,
  points: DiscussionPoint[]
): string {
  if (inspection.velocity.paceStatus !== "behind") {
    return "";
  }

  const openPoints = points.filter((point) => !point.covered);
  const nextPointsList = openPoints
    .slice(0, 2)
    .map((point) => `- ${point.id}: ${point.text}`)
    .join("\n");

  return ` The conversation is behind pace on discussion points — ${inspection.velocity.openCount} point(s) remain with about ${inspection.velocity.remainingMinutes.toFixed(
    1
  )} minutes left. Pick up the pace over the next few turns, but never direct a single speaker to cover more than one new point in one turn — cramming several points into one monologue is worse than falling behind. Move to the next point:\n${nextPointsList}`;
}

function buildConversationHistory(script: PodcastScript): string {
  return script.speeches
    .map((speech) => `${speech.speaker.name}: ${speech.message} [${speech.tool ?? "unknown"}]`)
    .join("\n");
}

/**
 * Builds a simplified subset of the director prompt that chooseNextSpeaker uses.
 * Omits pacing/balance/rhythm/signpost notes, editorial guidance, device guidance,
 * and epistemic-role/personality descriptions, focusing instead on immediate
 * direction and editorial moves. Parameterised on an already-computed EpisodeInspection
 * instead of reading instance state, and returns the raw claim without applying it anywhere:
 * no turnsUsed increment, no discussion-point/beat mutation.
 */
export async function proposeTurnDirection(
  callModel: StructuredModelCaller<SelectNextSpeakerInput>,
  script: PodcastScript,
  podcastPlan: string,
  points: DiscussionPoint[],
  inspection: EpisodeInspection,
  guidance?: string
): Promise<TurnProposal> {
  const openPointsSection = buildOpenPointsSection(points);
  const wrapUpNote = buildWrapUpNote(inspection);
  const velocityNote = buildVelocityNote(inspection, points);
  const guidanceNote = guidance
    ? ` Keep steering the conversation in line with the producer's guidance for this episode: ${guidance}`
    : "";
  const history = buildConversationHistory(script);
  const speakerDescriptions = script.speakers.map((speaker) => `- ${speaker.name} (id: ${speaker.id})`).join("\n");

  const messages = [
    {
      role: "user" as const,
      content: `You are directing a podcast. Here's the current situation:

Podcast Plan: ${podcastPlan}

Progress: ${inspection.progress}% complete${openPointsSection}

Speakers:
${speakerDescriptions}

Conversation so far (each line tagged with the tool used to deliver it — "speak" is substantive content; "interject", "filler_comment", "one_liner", and "short_question" are brief reactions, not real answers or new points):
${history || "(nothing said yet — this is the opening of the episode)"}

Decide which speaker should talk next. Only give them direction if it's actually needed — a brief goal or topic, not a script. Also choose a subject-neutral editorial move, the primary audience value, desired energy, relevant beat and prepared card ids. Mark genuinely completed beat ids in coveredBeatIds. If the open discussion points list above shows points already addressed by recent turns, mark their ids in coveredPointIds — only mark a point covered if it was explicitly and substantively discussed with specific detail from the point's text. Use Australian/British spelling.${wrapUpNote}${velocityNote}${guidanceNote}`,
    },
  ];

  const result = await callModel(
    ModelTask.DirectionSelection,
    messages,
    createSelectNextSpeakerSchema(script.speakers),
    MAX_TURN_DIRECTION_TOKENS
  );

  if (result.moveRationale) {
    logger.debug(
      `Director move rationale (${result.move ?? "unspecified"}): ${result.moveRationale}`
    );
  }

  return {
    speakerId: result.speakerId,
    direction: result.direction ?? "",
    claimedCoveredPointIds: result.coveredPointIds ?? [],
    claimedCoveredBeatIds: result.coveredBeatIds ?? [],
    beatId: result.beatId,
    move: result.move,
    cardIds: result.cardIds ?? [],
    audienceValue: result.audienceValue,
    desiredEnergy: result.desiredEnergy,
    device: result.device,
    moveRationale: result.moveRationale,
  };
}
