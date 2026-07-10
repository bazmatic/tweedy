import axios from 'axios';
import * as fs from 'fs-extra';
import * as path from 'path';
import { BaseVocalProvider } from './BaseVocalProvider';
import { VocalProviderTtsParams, Voice, VocalProviderName } from '../types';
import { appConfig } from '../utils/config';
import { logger } from '../utils/logger';

export class GrokProvider extends BaseVocalProvider {
  private apiKey: string;
  private baseUrl = 'https://api.x.ai/v1';

  constructor() {
    super();
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      throw new Error('XAI_API_KEY environment variable is required');
    }
    this.apiKey = apiKey;
  }

  protected getProviderName(): string {
    return 'Grok';
  }

  private get headers() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  async tts(params: VocalProviderTtsParams): Promise<string> {
    this.validateParams(params);
    this.logTtsRequest(params);

    try {
      const outputPath = path.join(appConfig.audioDir, params.outputFileName);
      await fs.ensureDir(path.dirname(outputPath));

      const options = params.voice.settings.providerOptions || {};

      const response = await axios.post(
        `${this.baseUrl}/tts`,
        {
          text: params.speech.message,
          voice_id: params.voice.providerId,
          language: options.language ?? 'auto',
          output_format: { container: 'mp3', sample_rate: 24000 },
          ...(options.speed !== undefined ? { speed: options.speed } : {}),
        },
        {
          headers: this.headers,
          responseType: 'arraybuffer',
        }
      );

      await fs.writeFile(outputPath, Buffer.from(response.data));
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
        headers: this.headers,
      });

      const voices = response.data.data ?? response.data;

      return voices.map((voice: any) => ({
        id: voice.id,
        name: voice.name,
        description: voice.description || voice.name,
        provider: VocalProviderName.Grok,
        providerId: voice.id,
        settings: {},
      }));
    } catch (error) {
      logger.error('Failed to get Grok voices:', error);
      throw error;
    }
  }
}
