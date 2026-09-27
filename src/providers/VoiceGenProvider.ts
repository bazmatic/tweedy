import axios from 'axios';
import * as fs from 'fs-extra';
import * as path from 'path';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { BaseVocalProvider } from './BaseVocalProvider';
import { AiModelFactory } from './AiModelFactory';
import { ModelTask } from './ModelRoutingPolicy';
import {
  VocalProviderTtsParams,
  TtsResult,
  Voice,
  VocalProviderName,
  TranscriptionProviderName,
} from '../types';
import { appConfig } from '../utils/config';
import { logger } from '../utils/logger';
import { TranscriptionProviderFactory } from './TranscriptionProviderFactory';
import {
  estimateSequenceLength,
  isTranscriptComplete,
  nextSequenceLength,
  MAX_VERIFY_ATTEMPTS,
} from './voicegen-sequence-length';

const MAX_TTS_ATTEMPTS = 6;
const BASE_RETRY_DELAY_MS = 3000;

const ALLOWED_TAGS = [
  'laughs',
  'sighs',
  'gasps',
  'whispering',
  'exhales',
  'happy',
  'angry',
  'singing',
  'excited',
];

const ANY_TAG_PATTERN = /\([^)]*\)/g;
const ALLOWED_TAG_TEST = new RegExp(`^\\((${ALLOWED_TAGS.join('|')})\\)$`, 'i');

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function stripDisallowedTags(text: string): string {
  return text.replace(ANY_TAG_PATTERN, (match) => (ALLOWED_TAG_TEST.test(match) ? match : ''));
}

function backoffDelayMs(attempt: number): number {
  return BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
}

function isRetryableError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  // No response at all (network/timeout) or a 5xx from the server — both are
  // transient conditions worth a retry, unlike a 4xx (bad request) which
  // will just fail the same way again.
  return !error.response || error.response.status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class VoiceGenProvider extends BaseVocalProvider {
  protected baseUrl: string;

  constructor() {
    super();
    this.baseUrl = process.env.VOICEGEN_BASE_URL || 'http://192.168.200.196:8000';
  }

  protected getProviderName(): string {
    return 'VoiceGen';
  }

  private async addDeliveryTags(text: string): Promise<string> {
    try {
      const model = AiModelFactory.getModel(
        appConfig.defaultAiProvider,
        ModelTask.SpeechEffectTagging,
        500
      );
      const response = await model.invoke([
        new SystemMessage(
          'You add delivery-direction tags to text for a text-to-speech engine. ' +
            'You may ONLY use these exact parenthetical tags, verbatim, nothing else: ' +
            ALLOWED_TAGS.map((t) => `(${t})`).join(', ') +
            '. Do not invent new tags or wording — any tag outside this list will be discarded. ' +
            'Use them sparingly: most lines should come back completely unchanged, with zero tags added — ' +
            'only add one where it clearly improves delivery. Never add more than one tag to a short line. ' +
            'Do not change, add, or remove a single word, letter, or punctuation mark of the original text — ' +
            'the only thing you may add is parenthetical tags from the list above. ' +
            'Respond with only the tagged text, nothing else — no commentary, no markdown fences.'
        ),
        new HumanMessage(text),
      ]);

      const rawTagged = typeof response.content === 'string' ? response.content.trim() : '';
      if (!rawTagged) return text;

      const tagged = stripDisallowedTags(rawTagged);

      const strippedOfTags = tagged.replace(ANY_TAG_PATTERN, '');
      if (normalizeWhitespace(strippedOfTags) !== normalizeWhitespace(text)) {
        logger.warn(
          'VoiceGen delivery-tagged text failed validation (altered wording), using plain text'
        );
        return text;
      }

      if (tagged !== text) {
        logger.info(`VoiceGen delivery tags applied: "${tagged}"`);
      }
      return tagged;
    } catch (error) {
      logger.warn('Failed to add VoiceGen delivery tags, using plain text:', error);
      return text;
    }
  }

  private async synthesizeToFile(
    text: string,
    voice: Voice,
    sequenceLength: number,
    outputPath: string
  ): Promise<void> {
    for (let attempt = 1; attempt <= MAX_TTS_ATTEMPTS; attempt++) {
      try {
        const response = await axios.post(
          `${this.baseUrl}/voices/${voice.providerId}/tts`,
          {
            text,
            params: {
              sequence_length: sequenceLength,
              ...voice.settings.providerOptions,
            },
          },
          {
            headers: {
              'Accept': 'audio/wav',
              'Content-Type': 'application/json',
            },
            responseType: 'arraybuffer',
          }
        );

        await fs.writeFile(outputPath, response.data);
        return;
      } catch (error) {
        const isLastAttempt = attempt === MAX_TTS_ATTEMPTS;
        if (!isRetryableError(error) || isLastAttempt) {
          this.logTtsError(error);
          throw error;
        }
        const delayMs = backoffDelayMs(attempt);
        logger.warn(
          `VoiceGen TTS request failed (attempt ${attempt}/${MAX_TTS_ATTEMPTS}), retrying in ${delayMs}ms: ${error}`
        );
        await sleep(delayMs);
      }
    }

    throw new Error('Unreachable: VoiceGen TTS retry loop exited without returning or throwing');
  }

  // Whisper's language auto-detect can misread this engine's slow, hushed
  // delivery style as a foreign language and garble the transcript — that's a
  // verification-tooling artifact, not a real TTS defect (confirmed by forcing
  // `language: 'en'` on samples that looked "broken" and finding them correct).
  // Forcing English here avoids reproducing that false positive.
  private async countSpokenWords(audioPath: string): Promise<number | null> {
    try {
      const provider = TranscriptionProviderFactory.getProvider(
        TranscriptionProviderName.OpenAIWhisper
      );
      const { words } = await provider.transcribe(audioPath, { language: 'en' });
      return words.length;
    } catch (error) {
      logger.warn('VoiceGen output verification failed, accepting audio as-is:', error);
      return null;
    }
  }

  async tts(params: VocalProviderTtsParams): Promise<TtsResult> {
    this.validateParams(params);
    this.logTtsRequest(params);

    const outputPath = path.join(appConfig.audioDir, params.outputFileName);
    await fs.ensureDir(path.dirname(outputPath));

    const text = await this.addDeliveryTags(params.speech.message);
    const originalWordCount = text.trim().split(/\s+/).filter(Boolean).length;

    const explicitSequenceLength = params.voice.settings.providerOptions?.sequence_length;
    const hasExplicitSequenceLength = typeof explicitSequenceLength === 'number';
    let sequenceLength = hasExplicitSequenceLength
      ? (explicitSequenceLength as number)
      : estimateSequenceLength(text);

    for (let verifyAttempt = 1; verifyAttempt <= MAX_VERIFY_ATTEMPTS; verifyAttempt++) {
      await this.synthesizeToFile(text, params.voice, sequenceLength, outputPath);

      if (hasExplicitSequenceLength) break;

      const spokenWordCount = await this.countSpokenWords(outputPath);
      const isLastAttempt = verifyAttempt === MAX_VERIFY_ATTEMPTS;

      if (spokenWordCount === null || isTranscriptComplete(spokenWordCount, originalWordCount)) {
        break;
      }

      if (isLastAttempt) {
        logger.warn(
          `VoiceGen output for "${params.outputFileName}" still looks truncated after ` +
            `${MAX_VERIFY_ATTEMPTS} attempts (${spokenWordCount}/${originalWordCount} words spoken) — using it as-is`
        );
        break;
      }

      sequenceLength = nextSequenceLength(sequenceLength, spokenWordCount, originalWordCount);
      logger.warn(
        `VoiceGen output for "${params.outputFileName}" looked truncated ` +
          `(${spokenWordCount}/${originalWordCount} words spoken), retrying with sequence_length=${sequenceLength}`
      );
    }

    this.logTtsSuccess(outputPath);
    return { outputPath };
  }

  async getVoices(): Promise<Voice[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/voices`);

      return response.data.map((voice: any) => ({
        id: voice.id,
        name: voice.name,
        description: voice.name,
        provider: VocalProviderName.VoiceGen,
        providerId: voice.id,
        settings: {},
      }));
    } catch (error) {
      logger.error('Failed to get VoiceGen voices:', error);
      throw error;
    }
  }
}
