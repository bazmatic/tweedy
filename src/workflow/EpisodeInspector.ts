import { EpistemicRole, PodcastScript } from "../types";
import { SpeakerRoleProfileResolver } from "../agents/SpeakerRoleProfileResolver";
import { SpeakerAgentToolName } from "../agents/speaker-tools";

export const WORDS_PER_MINUTE = 150;
export const DOMINANT_SPEAKER_SHARE_THRESHOLD = 0.55;
export const MIN_SPEECHES_FOR_BALANCE_CHECK = 3;
export const CLOSING_STAGE_PROGRESS_THRESHOLD = 85;
export const MAX_LATE_STAGE_TURNS = 2;

export interface EpisodeInspectionVelocity {
  coveredCount: number;
  openCount: number;
  elapsedMinutes: number;
  remainingMinutes: number;
  paceStatus: "ahead" | "on-pace" | "behind" | "unknown";
}

export interface DominantSpeaker {
  speakerId: string;
  share: number;
}

export interface EpisodeInspectionBudget {
  maxTurns: number;
  maxDuration: number;
}

export interface EpisodeInspection {
  progress: number;
  elapsedSeconds: number;
  isFinalTurn: boolean;
  velocity: EpisodeInspectionVelocity;
  dominantSpeaker: DominantSpeaker | null;
  hasAnnouncedTimePressure: boolean;
}

export function estimateElapsedSeconds(script: PodcastScript): number {
  const totalWords = script.speeches.reduce(
    (sum, speech) => sum + speech.message.trim().split(/\s+/).filter(Boolean).length,
    0
  );
  return (totalWords / WORDS_PER_MINUTE) * 60;
}

/**
 * Progress toward the estimated spoken duration budget. maxTurns is a
 * separate hard safety ceiling, not a pacing signal, so it plays no part
 * in this percentage.
 */
export function calculateProgress(script: PodcastScript, maxDuration: number): number {
  const durationProgress =
    maxDuration > 0 ? estimateElapsedSeconds(script) / maxDuration : 0;
  return Math.min(100, Math.round(durationProgress * 100));
}

/**
 * Compares points-covered-per-minute against points-needed-per-minute to
 * finish the remaining open points within the remaining time budget.
 */
export function calculateVelocity(
  script: PodcastScript,
  maxDuration: number,
  totalPoints: number,
  coveredCount: number
): EpisodeInspectionVelocity {
  if (totalPoints === 0) {
    return { coveredCount: 0, openCount: 0, elapsedMinutes: 0, remainingMinutes: 0, paceStatus: "unknown" };
  }

  const elapsedSeconds = estimateElapsedSeconds(script);
  const elapsedMinutes = elapsedSeconds / 60;
  const remainingMinutes = Math.max((maxDuration - elapsedSeconds) / 60, 0.1);
  const openCount = totalPoints - coveredCount;

  if (elapsedMinutes <= 0) {
    return { coveredCount, openCount, elapsedMinutes, remainingMinutes, paceStatus: "unknown" };
  }

  const actualPace = coveredCount / Math.max(elapsedMinutes, 0.1);
  const neededPace = openCount / remainingMinutes;

  let paceStatus: "ahead" | "on-pace" | "behind";
  if (actualPace < neededPace * 0.9) {
    paceStatus = "behind";
  } else if (actualPace > neededPace * 1.25) {
    paceStatus = "ahead";
  } else {
    paceStatus = "on-pace";
  }

  return { coveredCount, openCount, elapsedMinutes, remainingMinutes, paceStatus };
}

/**
 * Flags when a non-expert speaker has taken a disproportionate share of
 * words so far. Experts are exempt — they're expected to carry substantive
 * explaining.
 */
export function findDominantSpeaker(
  script: PodcastScript,
  roleProfileResolver: SpeakerRoleProfileResolver
): DominantSpeaker | null {
  if (script.speakers.length < 2 || script.speeches.length < MIN_SPEECHES_FOR_BALANCE_CHECK) {
    return null;
  }

  const wordCounts = new Map<string, number>();
  let totalWords = 0;
  for (const speech of script.speeches) {
    const words = speech.message.trim().split(/\s+/).filter(Boolean).length;
    wordCounts.set(speech.speaker.id, (wordCounts.get(speech.speaker.id) ?? 0) + words);
    totalWords += words;
  }
  if (totalWords === 0) {
    return null;
  }

  for (const speaker of script.speakers) {
    if (roleProfileResolver.resolve(speaker).epistemicRole === EpistemicRole.Expert) {
      continue;
    }
    const share = (wordCounts.get(speaker.id) ?? 0) / totalWords;
    if (share > DOMINANT_SPEAKER_SHARE_THRESHOLD) {
      return { speakerId: speaker.id, share };
    }
  }

  return null;
}

/**
 * Pure snapshot of everything DirectorAgent.chooseNextSpeaker used to
 * calculate from private instance fields. Callers must increment
 * turnsUsed/lateStageTurns for the current turn before calling this (see
 * DirectorAgent.chooseNextSpeaker, which does `this.turnsUsed++` before
 * calculating progress).
 */
export function inspectEpisode(
  script: PodcastScript,
  budget: EpisodeInspectionBudget,
  turnsUsed: number,
  lateStageTurns: number,
  totalPoints: number,
  coveredCount: number,
  roleProfileResolver: SpeakerRoleProfileResolver = new SpeakerRoleProfileResolver()
): EpisodeInspection {
  const progress = calculateProgress(script, budget.maxDuration);
  const isFinalTurn =
    turnsUsed >= budget.maxTurns || progress >= 100 || lateStageTurns >= MAX_LATE_STAGE_TURNS;
  const velocity = calculateVelocity(script, budget.maxDuration, totalPoints, coveredCount);
  const dominantSpeaker = findDominantSpeaker(script, roleProfileResolver);
  const hasAnnouncedTimePressure = script.speeches.some(
    (speech) => speech.tool === SpeakerAgentToolName.NEARLY_OUT_OF_TIME
  );

  return {
    progress,
    elapsedSeconds: estimateElapsedSeconds(script),
    isFinalTurn,
    velocity,
    dominantSpeaker,
    hasAnnouncedTimePressure,
  };
}
