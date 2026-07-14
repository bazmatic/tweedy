import { Speech } from "../types";

const RECENT_SPEECH_LIMIT = 6;

/** Prevents model and reviewer agreement from persisting repeated dialogue. */
export class SpeechRepetitionPolicy {
  isRepetition(candidate: Speech, recentSpeeches: Speech[]): boolean {
    const candidateMessage = this.normalise(candidate.message);
    if (!candidateMessage) return false;

    return recentSpeeches
      .slice(-RECENT_SPEECH_LIMIT)
      .some(
        (speech) =>
          speech.speaker.id === candidate.speaker.id &&
          this.normalise(speech.message) === candidateMessage
      );
  }

  private normalise(message: string): string {
    return message
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }
}
