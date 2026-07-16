import axios, { AxiosError } from 'axios';
import * as fs from 'fs-extra';
import * as path from 'path';
import { GoogleAuth } from 'google-auth-library';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { BaseVocalProvider } from './BaseVocalProvider';
import { VocalProviderTtsParams, TtsResult, Voice, VocalProviderName } from '../types';
import { appConfig } from '../utils/config';
import { logger } from '../utils/logger';
import { AiModelFactory } from './AiModelFactory';
import { ModelTask } from './ModelRoutingPolicy';
import { VALID_TAG_PATTERN, VALID_INLINE_TAGS, VALID_WRAPPING_TAGS, toSsml } from './google-chirp-ssml-tags';

const DEFAULT_LANGUAGE_CODE = 'en-US';
const AUTH_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

interface GoogleVoiceListEntry {
  name: string;
  languageCodes: string[];
  ssmlGender: string;
}

export class GoogleChirpProvider extends BaseVocalProvider {
  private auth: GoogleAuth;
  private baseUrl = 'https://texttospeech.googleapis.com/v1';

  constructor() {
    super();
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      throw new Error('GOOGLE_APPLICATION_CREDENTIALS environment variable is required');
    }
    this.auth = new GoogleAuth({ scopes: [AUTH_SCOPE] });
  }

  protected getProviderName(): string {
    return 'GoogleChirp';
  }

  private redactAuthHeader(error: unknown): unknown {
    if (!axios.isAxiosError(error)) return error;

    const redacted = error as AxiosError;
    if (redacted.config?.headers?.Authorization) {
      redacted.config.headers.Authorization = '[REDACTED]';
    }
    if ((redacted.request as { _header?: string } | undefined)?._header) {
      (redacted.request as { _header?: string })._header = (
        redacted.request as { _header: string }
      )._header.replace(/Authorization: Bearer [^\r\n]+/i, 'Authorization: [REDACTED]');
    }
    return redacted;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const client = await this.auth.getClient();
    const { token } = await client.getAccessToken();
    if (!token) {
      throw new Error('Failed to obtain a Google Cloud access token');
    }
    return { Authorization: `Bearer ${token}` };
  }

  private async addExpressiveMarkup(text: string): Promise<string | undefined> {
    try {
      const model = AiModelFactory.getModel(
        appConfig.defaultAiProvider,
        ModelTask.SpeechEffectTagging,
        500
      );
      const response = await model.invoke([
        new SystemMessage(
          "You add expressive speech markup to text for Google Cloud Text-to-Speech's Chirp3-HD voices. " +
            "Chirp3-HD supports exactly these tags, and ONLY these — do not invent, rename, or add any other tag:\n" +
            `- Inline tags (self-closing, never have a closing counterpart): ${VALID_INLINE_TAGS.map((t) => `[${t}]`).join(', ')}\n` +
            `- Wrapping tags (open/close pair, can be stacked): ${VALID_WRAPPING_TAGS.map((t) => `<${t}>...</${t}>`).join(', ')}\n` +
            "Insert tags naturally and sparingly wherever they fit the tone of the text — do not overuse them. " +
            "Do not change, add, or remove a single word, letter, or punctuation mark of the original text — " +
            "the only thing you may add is tags from the list above. " +
            "Respond with only the tagged text, nothing else — no commentary, no markdown fences."
        ),
        new HumanMessage(text),
      ]);

      const tagged =
        typeof response.content === 'string' ? response.content.trim() : '';
      if (!tagged) return undefined;

      const strippedOfValidTags = tagged.replace(VALID_TAG_PATTERN, '');
      if (normalizeWhitespace(strippedOfValidTags) !== normalizeWhitespace(text)) {
        logger.warn(
          'Chirp effect-tagged text failed validation (malformed tags or altered wording), using plain text'
        );
        return undefined;
      }

      return toSsml(tagged);
    } catch (error) {
      logger.warn('Failed to add Chirp expressive markup, using plain text:', error);
      return undefined;
    }
  }

  async tts(params: VocalProviderTtsParams): Promise<TtsResult> {
    this.validateParams(params);
    this.logTtsRequest(params);

    try {
      const outputPath = path.join(appConfig.audioDir, params.outputFileName);
      await fs.ensureDir(path.dirname(outputPath));

      const options = params.voice.settings.providerOptions || {};
      const languageCode = (options.languageCode as string) ?? DEFAULT_LANGUAGE_CODE;
      const authHeaders = await this.authHeaders();
      const ssml = await this.addExpressiveMarkup(params.speech.message);

      const response = await axios.post(
        `${this.baseUrl}/text:synthesize`,
        {
          input: ssml ? { ssml } : { text: params.speech.message },
          voice: { languageCode, name: params.voice.providerId },
          audioConfig: {
            audioEncoding: 'MP3',
            ...(options.speakingRate !== undefined ? { speakingRate: options.speakingRate } : {}),
          },
        },
        { headers: { ...authHeaders, 'Content-Type': 'application/json' } }
      );

      const audioBuffer = Buffer.from(response.data.audioContent, 'base64');
      await fs.writeFile(outputPath, audioBuffer);
      this.logTtsSuccess(outputPath);

      return { outputPath };
    } catch (error) {
      this.logTtsError(this.redactAuthHeader(error));
      throw error;
    }
  }

  async getVoices(): Promise<Voice[]> {
    try {
      const authHeaders = await this.authHeaders();
      const response = await axios.get(`${this.baseUrl}/voices`, {
        headers: authHeaders,
      });

      const voices: GoogleVoiceListEntry[] = response.data.voices ?? [];

      return voices
        .filter((voice) => voice.name.includes('Chirp3-HD'))
        .map((voice) => {
          const languageCode = voice.languageCodes[0];
          const shortName = voice.name.split('-').slice(4).join('-');

          return {
            id: voice.name,
            name: `${shortName} (${languageCode})`,
            description: `Google Chirp3-HD voice, ${languageCode}, ${voice.ssmlGender}`,
            provider: VocalProviderName.GoogleChirp,
            providerId: voice.name,
            settings: { providerOptions: { languageCode } },
          };
        });
    } catch (error) {
      logger.error('Failed to get Google Chirp voices:', this.redactAuthHeader(error));
      throw error;
    }
  }
}
