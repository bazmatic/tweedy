import axios from 'axios';
import * as fs from 'fs-extra';
import * as path from 'path';
import { BaseVocalProvider } from './BaseVocalProvider';
import { VocalProviderTtsParams, Voice, VocalProviderName } from '../types';
import { appConfig } from '../utils/config';
import { logger } from '../utils/logger';

export class HumeProvider extends BaseVocalProvider {
  private apiKey: string;
  private baseUrl = 'https://api.hume.ai/v0';

  constructor() {
    super();
    this.apiKey = process.env.HUME_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('HUME_API_KEY environment variable is required');
    }
  }

  protected getProviderName(): string {
    return 'Hume';
  }

  async tts(params: VocalProviderTtsParams): Promise<string> {
    this.validateParams(params);
    this.logTtsRequest(params);

    try {
      const outputPath = path.join(appConfig.audioDir, params.outputFileName);
      await fs.ensureDir(path.dirname(outputPath));

      const speed = params.voice.settings.providerOptions?.speed;

      const response = await axios.post(
        `${this.baseUrl}/tts`,
        {
          utterances: [
            {
              text: params.speech.message,
              voice: { id: params.voice.providerId },
              description: params.voice.settings.instructions,
              ...(speed !== undefined ? { speed } : {}),
            },
          ],
        },
        {
          headers: {
            'X-Hume-Api-Key': this.apiKey,
            'Content-Type': 'application/json',
          },
        }
      );

      const base64Audio = response.data.generations?.[0]?.audio;
      if (!base64Audio) {
        throw new Error('Hume TTS response did not contain audio data');
      }

      await fs.writeFile(outputPath, Buffer.from(base64Audio, 'base64'));
      this.logTtsSuccess(outputPath);

      return outputPath;
    } catch (error) {
      this.logTtsError(error);
      throw error;
    }
  }

  async getVoices(): Promise<Voice[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/tts/voices`, {
        headers: {
          'X-Hume-Api-Key': this.apiKey,
        },
        params: {
          provider: 'HUME_AI',
        },
      });

      const voices = response.data.voices_page ?? response.data.voices ?? [];

      return voices.map((voice: any) => ({
        id: voice.id,
        name: voice.name,
        description: voice.name,
        provider: VocalProviderName.Hume,
        providerId: voice.id,
        settings: {},
      }));
    } catch (error) {
      logger.error('Failed to get Hume voices:', error);
      throw error;
    }
  }
}
