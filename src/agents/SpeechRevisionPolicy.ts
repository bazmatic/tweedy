const TERMINAL_PUNCTUATION = Object.freeze([".", "!", "?", "…", "..."]);

/** Rejects empty or visibly truncated reviewer revisions before persistence. */
export class SpeechRevisionPolicy {
  isUsable(revisedMessage: string): boolean {
    const message = revisedMessage.trim();
    if (message.length === 0) return false;
    return TERMINAL_PUNCTUATION.some((punctuation) =>
      message.endsWith(punctuation)
    );
  }
}
