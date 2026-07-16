import axios, { AxiosError } from 'axios';
import * as fs from 'fs-extra';
import * as path from 'path';
import { GoogleAuth } from 'google-auth-library';
import { BaseVocalProvider } from './BaseVocalProvider';
import { VocalProviderTtsParams, TtsResult, Voice, VocalProviderName } from '../types';
import { appConfig } from '../utils/config';
import { logger } from '../utils/logger';

const DEFAULT_LANGUAGE_CODE = 'en-US';
const AUTH_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

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

  async tts(params: VocalProviderTtsParams): Promise<TtsResult> {
    this.validateParams(params);
    this.logTtsRequest(params);

    try {
      const outputPath = path.join(appConfig.audioDir, params.outputFileName);
      await fs.ensureDir(path.dirname(outputPath));

      const options = params.voice.settings.providerOptions || {};
      const languageCode = (options.languageCode as string) ?? DEFAULT_LANGUAGE_CODE;
      const authHeaders = await this.authHeaders();

      const response = await axios.post(
        `${this.baseUrl}/text:synthesize`,
        {
          input: { text: params.speech.message },
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
