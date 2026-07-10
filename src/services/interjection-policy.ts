import { Speech } from "../types";
import { SpeakerAgentToolName } from "../agents/speaker-tools";

export const INTERJECTION_LENGTH_THRESHOLD = 80;
export const INTERJECTION_CHANCE = 0.8;

type InterjectionCandidate = Pick<Speech, "tool" | "message" | "stopReason">;

/**
 * A speech cut off by the token limit is exactly the moment a co-host
 * jumping in sounds most natural, so it always forces an interjection
 * rather than going through the length-and-chance roll.
 */
export function shouldInterject(
  speech: InterjectionCandidate,
  speakerCount: number,
  roll: number
): boolean {
  if (speakerCount <= 1) return false;

  if (speech.stopReason === "max_tokens") return true;

  const ranLong =
    speech.tool === SpeakerAgentToolName.SPEAK &&
    speech.message.length > INTERJECTION_LENGTH_THRESHOLD;

  return ranLong && roll < INTERJECTION_CHANCE;
}
