import axios from 'axios';
import * as fs from 'fs-extra';
import * as path from 'path';
import { BaseVocalProvider } from './BaseVocalProvider';
import { VocalProviderTtsParams, Voice, VocalProviderName } from '../types';
import { appConfig } from '../utils/config';
import { logger } from '../utils/logger';

const CARTESIA_API_VERSION = '2025-04-16';

export class CartesiaProvider extends BaseVocalProvider {
  private apiKey: string;
  private baseUrl = 'https://api.cartesia.ai';

  constructor() {
    super();
    this.apiKey = process.env.CARTESIA_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('CARTESIA_API_KEY environment variable is required');
    }
  }

  protected getProviderName(): string {
    return 'Cartesia';
  }

  private get headers() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Cartesia-Version': CARTESIA_API_VERSION,
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
      const generationConfig: Record<string, unknown> = {};
      if (options.emotion !== undefined) generationConfig.emotion = options.emotion;
      if (options.speed !== undefined) generationConfig.speed = options.speed;
      if (options.volume !== undefined) generationConfig.volume = options.volume;

      const response = await axios.post(
        `${this.baseUrl}/tts/bytes`,
        {
          model_id: 'sonic-3',
          transcript: params.speech.message,
          voice: { mode: 'id', id: params.voice.providerId },
          output_format: {
            container: 'mp3',
            sample_rate: 44100,
          },
          ...(Object.keys(generationConfig).length > 0
            ? { generation_config: generationConfig }
            : {}),
        },
        {
          headers: this.headers,
          responseType: 'arraybuffer',
        }
      );

      await fs.writeFile(outputPath, response.data);
      this.logTtsSuccess(outputPath);

      return outputPath;
    } catch (error) {
      this.logTtsError(error);
      throw error;
    }
  }

  async getVoices(): Promise<Voice[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/voices`, {
        headers: this.headers,
      });

      const voices = response.data.data ?? response.data;

      return voices.map((voice: any) => ({
        id: voice.id,
        name: voice.name,
        description: voice.description || voice.name,
        provider: VocalProviderName.Cartesia,
        providerId: voice.id,
        settings: {},
      }));
    } catch (error) {
      logger.error('Failed to get Cartesia voices:', error);
      throw error;
    }
  }
}
