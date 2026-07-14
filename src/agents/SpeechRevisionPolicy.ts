const TERMINAL_PUNCTUATION = Object.freeze([".", "!", "?", "…", "..."]);
const MAX_REVISED_WORDS = 60;

/** Rejects empty or visibly truncated reviewer revisions before persistence. */
export class SpeechRevisionPolicy {
  isUsable(revisedMessage: string): boolean {
    const message = revisedMessage.trim();
    if (message.length === 0) return false;
    if (message.split(/\s+/).length > MAX_REVISED_WORDS) return false;
    return TERMINAL_PUNCTUATION.some((punctuation) =>
      message.endsWith(punctuation)
    );
  }
}
