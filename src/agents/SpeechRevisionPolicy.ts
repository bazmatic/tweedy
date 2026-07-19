const TERMINAL_PUNCTUATION = Object.freeze([".", "!", "?", "…", "..."]);
const MAX_REVISED_WORDS = 60;
// The closing statement is allowed far more room by its own tool definition
// (up to 600 tokens) than a normal turn's brevity-focused revision cap — a
// revision that adds the required farewell can legitimately run longer.
const MAX_REVISED_WORDS_CLOSING_STATEMENT = 90;

// Occasionally the reviewer model, given a malformed or empty prompt state,
// hallucinates a meta response about the review task itself rather than
// producing replacement dialogue (e.g. "No speech was provided to review.
// Please supply the turn text to be assessed."). These pass the length and
// punctuation checks but are never something a podcast speaker would say.
const META_COMMENTARY_PATTERNS = Object.freeze([
  /\bno speech was provided\b/i,
  /\bplease (supply|provide) the (turn|speech)\b/i,
  /\bturn text to be assessed\b/i,
  /\bas an ai\b/i,
  /\bi cannot (review|assess)\b/i,
]);

/** Rejects empty, visibly truncated, or meta-commentary reviewer revisions before persistence. */
export class SpeechRevisionPolicy {
  isUsable(revisedMessage: string, isClosingStatement = false): boolean {
    const message = revisedMessage.trim();
    if (message.length === 0) return false;
    const maxWords = isClosingStatement
      ? MAX_REVISED_WORDS_CLOSING_STATEMENT
      : MAX_REVISED_WORDS;
    if (message.split(/\s+/).length > maxWords) return false;
    if (META_COMMENTARY_PATTERNS.some((pattern) => pattern.test(message))) {
      return false;
    }
    return TERMINAL_PUNCTUATION.some((punctuation) =>
      message.endsWith(punctuation)
    );
  }
}
