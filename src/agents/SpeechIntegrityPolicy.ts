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

  /**
   * Catches a specific misattribution failure: the model loses track of
   * whose voice it is writing and has the speaker vocatively address
   * themselves by their own name, as if a co-host were asking them a
   * question ("Archie, do you think...") when the message is actually
   * supposed to be Archie's own words. A speaker legitimately referring to
   * themselves in the third person past tense ("like I said, Archie...")
   * is rare enough, and vocative-address-then-question is specific enough,
   * that this is cheap to check deterministically before the expensive
   * LLM review ever runs.
   */
  addressesSelfByName(message: string, speakerName: string): boolean {
    const firstName = speakerName.trim().split(/\s+/)[0];
    if (!firstName) return false;
    const escapedName = firstName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const vocativeQuestionPattern = new RegExp(
      `\\b${escapedName}\\b,\\s+(do|did|does|can|could|would|will|are|is|were|was|have|has|should|what|why|how|when|where)\\b[^.!?]*\\?`,
      "i"
    );
    return vocativeQuestionPattern.test(message.trim());
  }
}
