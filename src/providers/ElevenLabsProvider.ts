import axios from 'axios';
import * as crypto from 'crypto';
import * as fs from 'fs-extra';
import * as path from 'path';
import { BaseVocalProvider } from './BaseVocalProvider';
import { VocalProviderTtsParams, TtsResult, Voice, VocalProviderName } from '../types';
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

  // eleven_multilingual_v2 supports previous_request_ids stitching, but each
  // speech is synthesized independently here and we don't thread request IDs
  // between calls, so a deterministic per-voice seed plus high stability is
  // what keeps accent/timbre from drifting across clips instead.
  private seedForVoice(providerId: string): number {
    const hash = crypto.createHash('md5').update(providerId).digest();
    return hash.readUInt32BE(0);
  }

  async tts(params: VocalProviderTtsParams): Promise<TtsResult> {
    this.validateParams(params);
    this.logTtsRequest(params);

    try {
      const outputPath = path.join(appConfig.audioDir, params.outputFileName);
      await fs.ensureDir(path.dirname(outputPath));

      const response = await axios.post(
        `${this.baseUrl}/text-to-speech/${params.voice.providerId}`,
        {
          text: params.speech.message,
          model_id: 'eleven_multilingual_v2',
          seed: this.seedForVoice(params.voice.providerId),
          voice_settings: {
            stability: params.voice.settings.stability ?? 0.75,
            similarity_boost: params.voice.settings.similarityBoost || 0.75,
            style: params.voice.settings.style ?? 0,
            use_speaker_boost: true,
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

      return { outputPath };
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
          stability: 0.75,
          similarityBoost: 0.75,
          style: 0.0,
        },
      }));
    } catch (error) {
      logger.error('Failed to get ElevenLabs voices:', error);
      throw error;
    }
  }
}

