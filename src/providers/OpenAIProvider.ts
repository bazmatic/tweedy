import OpenAI from 'openai';
import * as fs from 'fs-extra';
import * as path from 'path';
import { BaseVocalProvider } from './BaseVocalProvider';
import { VocalProviderTtsParams, Voice, VocalProviderName } from '../types';
import { appConfig } from '../utils/config';
import { logger } from '../utils/logger';

export class OpenAIProvider extends BaseVocalProvider {
  private client: OpenAI;

  constructor() {
    super();
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    this.client = new OpenAI({ apiKey });
  }

  protected getProviderName(): string {
    return 'OpenAI';
  }

  async tts(params: VocalProviderTtsParams): Promise<string> {
    this.validateParams(params);
    this.logTtsRequest(params);

    try {
      const outputPath = path.join(appConfig.audioDir, params.outputFileName);
      await fs.ensureDir(path.dirname(outputPath));

      const response = await this.client.audio.speech.create({
        model: 'tts-1',
        voice: params.voice.providerId as any,
        input: params.speech.message,
        response_format: 'mp3',
      });

      const buffer = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(outputPath, buffer);
      
      this.logTtsSuccess(outputPath);
      return outputPath;
    } catch (error) {
      this.logTtsError(error);
      throw error;
    }
  }

  async getVoices(): Promise<Voice[]> {
    // OpenAI TTS has predefined voices
    const voices = [
      { id: 'alloy', name: 'Alloy', description: 'Neutral, balanced voice' },
      { id: 'echo', name: 'Echo', description: 'Clear, confident voice' },
      { id: 'fable', name: 'Fable', description: 'Warm, expressive voice' },
      { id: 'onyx', name: 'Onyx', description: 'Deep, authoritative voice' },
      { id: 'nova', name: 'Nova', description: 'Bright, energetic voice' },
      { id: 'shimmer', name: 'Shimmer', description: 'Soft, gentle voice' },
    ];

    return voices.map(voice => ({
      id: voice.id,
      name: voice.name,
      description: voice.description,
      provider: VocalProviderName.OpenAI,
      providerId: voice.id,
      settings: {
        instructions: voice.description,
      },
    }));
  }
}

