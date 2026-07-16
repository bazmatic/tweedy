// Genuine spoken dialogue never contains angle-bracket markup — a model
// occasionally leaks internal scaffolding (placeholder tags, stray
// "<tag>thinking</tag>"-style artifacts) into the message argument of an
// otherwise successful tool call, which nothing else catches since that
// text still parses as a valid tool call and passes any word/punctuation
// checks.
const LEAKED_ARTIFACT_PATTERN = /<[^>\n]{1,60}>/;

/** Deterministically rejects raw model output that leaked non-speech artifacts. */
export class SpeechIntegrityPolicy {
  isSpeakable(message: string): boolean {
    const trimmed = message.trim();
    if (trimmed.length === 0) return false;
    return !LEAKED_ARTIFACT_PATTERN.test(trimmed);
  }
}
