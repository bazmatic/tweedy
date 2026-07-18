/**
 * Strips markdown emphasis markers (*word*, **word**) from text bound for
 * plain text-to-speech input. Several TTS engines (Gemini, and at least one
 * VoiceGen voice observed reading `*important*` back as "slash important")
 * read literal asterisks aloud rather than treating them as emphasis, since
 * this is plain TTS input, not markdown-aware.
 */
export function stripMarkdownEmphasis(text: string): string {
  return text.replace(/\*+/g, "");
}
