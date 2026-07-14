import axios from 'axios';
import * as fs from 'fs-extra';
import * as path from 'path';
import { BaseVocalProvider } from './BaseVocalProvider';
import { VocalProviderTtsParams, TtsResult, Voice, VocalProviderName } from '../types';
import { appConfig } from '../utils/config';
import { logger } from '../utils/logger';

export class HumeProvider extends BaseVocalProvider {
  private apiKey: string;
  private baseUrl = 'https://api.hume.ai/v0';
  /** Last Hume generation_id per speaker, so consecutive lines from the same
   * character are conditioned on their own prior delivery (Hume's `context`
   * field) rather than each landing as an independent, unrelated read. */
  private lastGenerationBySpeaker = new Map<string, string>();

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

  /**
   * The voice's baseline instructions are the character's fixed delivery and
   * must dominate; a per-turn style is only a situational modifier layered on
   * top, not an equal-weight replacement, so pitch/style stays anchored to
   * the character instead of swinging with whatever adjective this line got.
   */
  private buildDescription(params: VocalProviderTtsParams): string | undefined {
    const baseline = params.voice.settings.instructions?.trim();
    const turnStyle = params.speech.instructions?.trim();

    if (!baseline) {
      return turnStyle || undefined;
    }
    if (!turnStyle) {
      return baseline;
    }

    return `${baseline}. Keep that same voice; for this line only, let the delivery lean slightly ${turnStyle}`;
  }

  async tts(params: VocalProviderTtsParams): Promise<TtsResult> {
    this.validateParams(params);
    this.logTtsRequest(params);

    try {
      const outputPath = path.join(appConfig.audioDir, params.outputFileName);
      await fs.ensureDir(path.dirname(outputPath));

      const speed = params.voice.settings.providerOptions?.speed;
      const speakerId = params.speech.speaker?.id;
      const priorGenerationId = speakerId ? this.lastGenerationBySpeaker.get(speakerId) : undefined;

      const response = await axios.post(
        `${this.baseUrl}/tts`,
        {
          utterances: [
            {
              text: params.speech.message,
              voice: { id: params.voice.providerId },
              description: this.buildDescription(params),
              ...(speed !== undefined ? { speed } : {}),
            },
          ],
          ...(priorGenerationId ? { context: { generation_id: priorGenerationId } } : {}),
        },
        {
          headers: {
            'X-Hume-Api-Key': this.apiKey,
            'Content-Type': 'application/json',
          },
        }
      );

      const generation = response.data.generations?.[0];
      const base64Audio = generation?.audio;
      if (!base64Audio) {
        throw new Error('Hume TTS response did not contain audio data');
      }

      if (speakerId && generation.generation_id) {
        this.lastGenerationBySpeaker.set(speakerId, generation.generation_id);
      }

      await fs.writeFile(outputPath, Buffer.from(base64Audio, 'base64'));
      this.logTtsSuccess(outputPath);

      return { outputPath };
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
