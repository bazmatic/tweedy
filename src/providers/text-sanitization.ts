/**
 * Strips markdown emphasis markers (*word*, **word**) and HTML tags
 * (<em>word</em>) from text bound for plain text-to-speech input. Several
 * TTS engines (Gemini, and at least one VoiceGen voice observed reading
 * `*important*` back as "slash important", or `<em>` literally) read markup
 * characters aloud rather than treating them as emphasis, since this is
 * plain TTS input, not markdown- or HTML-aware.
 */
export function stripMarkdownEmphasis(text: string): string {
  return text.replace(/<\/?[a-zA-Z][^>]*>/g, "").replace(/\*+/g, "");
}
