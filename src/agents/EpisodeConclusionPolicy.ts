import { PodcastScript } from "../types";
import { SpeakerAgentToolName } from "./speaker-tools";

/** Defines the structural condition required before an episode may finish. */
export class EpisodeConclusionPolicy {
  hasFinalSignOff(script: PodcastScript): boolean {
    const finalSpeech = script.speeches.at(-1);
    if (
      finalSpeech?.tool !== SpeakerAgentToolName.CLOSING_STATEMENT ||
      finalSpeech.stopReason === "max_tokens"
    ) {
      return false;
    }

    const message = finalSpeech.message.trim();
    if (!message || message.endsWith("?")) {
      return false;
    }

    // Terminal validation must not trust the tool label alone. The closing
    // prompt always asks for an explicit listener-facing farewell, so require
    // observable sign-off language before allowing the workflow to complete.
    return /\b(thanks? (?:for (?:joining|listening)|to (?:you|everyone))|thank you|goodbye|until next time|see you (?:next time|soon|then)|we(?:'|’)ll (?:see|catch) you)\b/i.test(
      message
    );
  }
}
