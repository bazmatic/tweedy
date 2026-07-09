import axios from 'axios';
import * as crypto from 'crypto';
import * as fs from 'fs-extra';
import * as path from 'path';
import { BaseVocalProvider } from './BaseVocalProvider';
import { VocalProviderTtsParams, Voice, VocalProviderName } from '../types';
import { appConfig } from '../utils/config';
import { logger } from '../utils/logger';

export class ElevenLabsProvider extends BaseVocalProvider {
  private apiKey: string;
  private baseUrl = 'https://api.elevenlabs.io/v1';

  constructor() {
    super();
    this.apiKey = process.env.ELEVENLABS_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('ELEVENLABS_API_KEY environment variable is required');
    }
  }

  protected getProviderName(): string {
    return 'ElevenLabs';
  }

  // previous_request_ids stitching isn't supported on eleven_v3, so consistency
  // instead comes from a deterministic per-voice seed plus a Robust-leaning default.
  private seedForVoice(providerId: string): number {
    const hash = crypto.createHash('md5').update(providerId).digest();
    return hash.readUInt32BE(0);
  }

  async tts(params: VocalProviderTtsParams): Promise<string> {
    this.validateParams(params);
    this.logTtsRequest(params);

    try {
      const outputPath = path.join(appConfig.audioDir, params.outputFileName);
      await fs.ensureDir(path.dirname(outputPath));

      // v3 only accepts discrete stability presets (0 Creative / 0.5 Natural / 1 Robust)
      // and has no speaker boost, unlike the older multilingual/turbo/flash models.
      // Default leans Robust (1) rather than Natural (0.5) for better accent consistency.
      const rawStability = params.voice.settings.stability ?? 1;
      const stability = [0, 0.5, 1].reduce((closest, preset) =>
        Math.abs(preset - rawStability) < Math.abs(closest - rawStability) ? preset : closest
      );

      const accent = params.voice.settings.providerOptions?.accent;
      const text = typeof accent === 'string' && accent.length > 0
        ? `[${accent} accent] ${params.speech.message}`
        : params.speech.message;

      const response = await axios.post(
        `${this.baseUrl}/text-to-speech/${params.voice.providerId}`,
        {
          text,
          model_id: 'eleven_v3',
          seed: this.seedForVoice(params.voice.providerId),
          voice_settings: {
            stability,
            similarity_boost: params.voice.settings.similarityBoost || 0.75,
            //style: params.voice.settings.style || 0.0,
          },
        },
        {
          headers: {
            'Accept': 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': this.apiKey,
          },
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
        headers: {
          'xi-api-key': this.apiKey,
        },
      });

      return response.data.voices.map((voice: any) => ({
        id: voice.voice_id,
        name: voice.name,
        description: voice.description || voice.name,
        provider: VocalProviderName.ElevenLabs,
        providerId: voice.voice_id,
        settings: {
          stability: 0.5,
          similarityBoost: 0.5,
          style: 0.0,
        },
      }));
    } catch (error) {
      logger.error('Failed to get ElevenLabs voices:', error);
      throw error;
    }
  }
}

