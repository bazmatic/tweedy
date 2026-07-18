import axios from 'axios';
import * as fs from 'fs-extra';
import * as path from 'path';
import { BaseVocalProvider } from './BaseVocalProvider';
import { VocalProviderTtsParams, TtsResult, Voice, VocalProviderName } from '../types';
import { appConfig } from '../utils/config';
import { logger } from '../utils/logger';

const MAX_TTS_ATTEMPTS = 6;
const BASE_RETRY_DELAY_MS = 3000;

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

  async tts(params: VocalProviderTtsParams): Promise<TtsResult> {
    this.validateParams(params);
    this.logTtsRequest(params);

    const outputPath = path.join(appConfig.audioDir, params.outputFileName);
    await fs.ensureDir(path.dirname(outputPath));

    for (let attempt = 1; attempt <= MAX_TTS_ATTEMPTS; attempt++) {
      try {
        const response = await axios.post(
          `${this.baseUrl}/voices/${params.voice.providerId}/tts`,
          {
            text: params.speech.message,
            params: {
              ...params.voice.settings.providerOptions,
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
        this.logTtsSuccess(outputPath);

        return { outputPath };
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
