import { PodcastScript } from "../types";
import { SpeakerAgentToolName } from "./speaker-tools";

/** Defines the structural condition required before an episode may finish. */
export class EpisodeConclusionPolicy {
  hasFinalSignOff(script: PodcastScript): boolean {
    const finalSpeech = script.speeches.at(-1);
    return (
      finalSpeech?.tool === SpeakerAgentToolName.CLOSING_STATEMENT &&
      finalSpeech.stopReason !== "max_tokens"
    );
  }
}
