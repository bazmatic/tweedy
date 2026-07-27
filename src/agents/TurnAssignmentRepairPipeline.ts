import { PodcastScript, Speaker, TurnBrief } from "../types";
import { RoleAssignment, SpeakerRolePolicy } from "./SpeakerRolePolicy";
import { CadenceAssignment, DialogueCadencePolicy } from "./DialogueCadencePolicy";

export interface ResolvedSpeaker {
  speaker: Speaker;
  usedFallback: boolean;
}

export interface RepairedAssignment extends CadenceAssignment {
  speakerResolutionFallback: boolean;
}

export function pingPongSpeaker(script: PodcastScript): Speaker {
  const lastSpeaker = script.speeches[script.speeches.length - 1]?.speaker;
  if (!lastSpeaker) {
    return script.speakers[0];
  }
  return (
    script.speakers.find((speaker) => speaker.id !== lastSpeaker.id) ??
    script.speakers[0]
  );
}

export function fallbackSpeaker(script: PodcastScript): Speaker {
  const lastSpeaker = script.speeches[script.speeches.length - 1]?.speaker;
  const eligible = script.speakers.filter((s) => s.id !== lastSpeaker?.id);
  if (eligible.length === 0) {
    return script.speakers[0];
  }
  return eligible[Math.floor(Math.random() * eligible.length)];
}

export function resolveSpeakerReference(
  script: PodcastScript,
  reference: string
): Speaker | undefined {
  const normalisedReference = reference.trim().toLocaleLowerCase();
  return script.speakers.find(
    (speaker) =>
      speaker.id.toLocaleLowerCase() === normalisedReference ||
      speaker.slug.toLocaleLowerCase() === normalisedReference ||
      speaker.name.toLocaleLowerCase() === normalisedReference
  );
}

/**
 * With exactly two speakers there's only one sensible turn order — ping-pong
 * deterministically rather than trusting the proposed speakerId, which can
 * otherwise let one speaker dominate several turns in a row.
 */
export function resolveProposedSpeaker(
  script: PodcastScript,
  speakerId: string
): ResolvedSpeaker {
  const proposedSpeaker =
    script.speakers.length === 2
      ? pingPongSpeaker(script)
      : resolveSpeakerReference(script, speakerId);
  if (proposedSpeaker) {
    return { speaker: proposedSpeaker, usedFallback: false };
  }
  return { speaker: fallbackSpeaker(script), usedFallback: true };
}

export function repairTurnAssignment(
  script: PodcastScript,
  speakerId: string,
  turnBrief: TurnBrief,
  direction: string,
  speakerRolePolicy: SpeakerRolePolicy,
  dialogueCadencePolicy: DialogueCadencePolicy
): RepairedAssignment {
  const { speaker, usedFallback } = resolveProposedSpeaker(script, speakerId);
  const roleAssignment: RoleAssignment = speakerRolePolicy.repairAssignment(
    script,
    speaker,
    { ...turnBrief, speakerId: speaker.id },
    direction
  );
  const cadenceAssignment = dialogueCadencePolicy.repairAssignment(script, roleAssignment);
  return { ...cadenceAssignment, speakerResolutionFallback: usedFallback };
}
