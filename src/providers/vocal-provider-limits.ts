import { VocalProviderName } from "../types";

/**
 * Some providers cap how much audio a single TTS call can generate. When a
 * speaker is on one of these voices, script generation must keep each turn
 * short enough to fit, since there is no post-hoc splitting for these calls.
 */
export const VOCAL_PROVIDER_MAX_GENERATION_SECONDS: Partial<
  Record<VocalProviderName, number>
> = {
  [VocalProviderName.VoiceGen]: 30,
};

// Conversational speech rate, used to translate a provider's time limit into
// a token budget for the speech-generation model call.
const WORDS_PER_SECOND = 2.5;
const TOKENS_PER_WORD = 1.3;

export function maxTokensForGenerationSeconds(seconds: number): number {
  return Math.floor(seconds * WORDS_PER_SECOND * TOKENS_PER_WORD);
}

export function getProviderMaxTokens(
  provider: VocalProviderName
): number | undefined {
  const maxSeconds = VOCAL_PROVIDER_MAX_GENERATION_SECONDS[provider];
  return maxSeconds === undefined
    ? undefined
    : maxTokensForGenerationSeconds(maxSeconds);
}

/**
 * The maxTokens passed to the model is only a soft guide — some AI providers
 * pad it with their own buffer for tool-call JSON overhead (see
 * AiModelFactory's DEEPSEEK_TOKEN_BUFFER), so it cannot be relied on as a
 * hard guarantee. This is the actual word-count ceiling to enforce after
 * generation for a provider with a real per-call audio duration limit.
 */
export function getProviderMaxWords(
  provider: VocalProviderName
): number | undefined {
  const maxSeconds = VOCAL_PROVIDER_MAX_GENERATION_SECONDS[provider];
  return maxSeconds === undefined
    ? undefined
    : Math.floor(maxSeconds * WORDS_PER_SECOND);
}

/**
 * Trims text to at most maxWords, preferring to cut at the last sentence
 * boundary within budget so the truncation reads as a natural stopping
 * point rather than a mid-word chop.
 */
export function truncateToWordBudget(
  text: string,
  maxWords: number
): { text: string; truncated: boolean } {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) {
    return { text, truncated: false };
  }

  const truncatedWords = words.slice(0, maxWords).join(" ");
  const lastSentenceEnd = Math.max(
    truncatedWords.lastIndexOf(". "),
    truncatedWords.lastIndexOf("! "),
    truncatedWords.lastIndexOf("? ")
  );
  const cut =
    lastSentenceEnd > truncatedWords.length * 0.4
      ? truncatedWords.slice(0, lastSentenceEnd + 1)
      : truncatedWords;

  return { text: cut, truncated: true };
}
