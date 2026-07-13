import { EpistemicRole, SpeakerRoleProfile } from "../types";

const SHARED_NATURAL_SPEECH_GUIDANCE = Object.freeze([
  "Use occasional filler words such as um, uh, like and you know.",
  "Use occasional pauses, ellipses, false starts and self-corrections.",
  "Use sentence fragments or a light stammer where they sound natural.",
  "Do not overuse any one speech habit or repeat the same reaction phrase.",
]);

const ROLE_DELIVERY_GUIDANCE: Readonly<Record<EpistemicRole, string>> =
  Object.freeze({
    [EpistemicRole.Expert]:
      "Hesitate while finding clear phrasing, not because foundational material surprises you or is unknown to you.",
    [EpistemicRole.InformedHost]:
      "Sound prepared but conversational; hesitation may reflect live synthesis rather than ignorance.",
    [EpistemicRole.AudienceGuide]:
      "Use hesitation naturally while formulating listener-centred questions and reactions.",
  });

/** Keeps delivery natural without allowing delivery style to redefine expertise. */
export class NaturalSpeechStylePolicy {
  buildGuidance(profile: SpeakerRoleProfile): string {
    return [
      ...SHARED_NATURAL_SPEECH_GUIDANCE,
      ROLE_DELIVERY_GUIDANCE[profile.epistemicRole],
    ].join(" ");
  }
}
