import { PodcastScript } from "../types";
import { SpeakerAgentToolName } from "./speaker-tools";

/** Defines the structural condition required before an episode may finish. */
export class EpisodeConclusionPolicy {
  hasFinalSignOff(script: PodcastScript): boolean {
    return (
      script.speeches.at(-1)?.tool === SpeakerAgentToolName.CLOSING_STATEMENT
    );
  }
}
