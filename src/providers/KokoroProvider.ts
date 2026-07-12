import OpenAI from 'openai';
import * as fs from 'fs-extra';
import * as path from 'path';
import { BaseVocalProvider } from './BaseVocalProvider';
import { VocalProviderTtsParams, TtsResult, Voice, VocalProviderName } from '../types';
import { appConfig } from '../utils/config';

export class KokoroProvider extends BaseVocalProvider {
  private client: OpenAI;
  private baseUrl: string;

  constructor() {
    super();
    this.baseUrl = process.env.KOKORO_BASE_URL || 'http://localhost:8880/v1';
    this.client = new OpenAI({ apiKey: 'not-needed', baseURL: this.baseUrl });
  }

  protected getProviderName(): string {
    return 'Kokoro';
  }

  async tts(params: VocalProviderTtsParams): Promise<TtsResult> {
    this.validateParams(params);
    this.logTtsRequest(params);

    try {
      const outputPath = path.join(appConfig.audioDir, params.outputFileName);
      await fs.ensureDir(path.dirname(outputPath));

      const response = await this.client.audio.speech.create({
        model: 'kokoro',
        voice: params.voice.providerId as any,
        input: params.speech.message,
        response_format: 'mp3',
        // Note: providerOptions is spread last, so a stray key (e.g. an accidental `input`) will silently override the fields above.
        ...(params.voice.settings.providerOptions || {}),
      } as any);

      const buffer = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(outputPath, buffer);

      this.logTtsSuccess(outputPath);
      return { outputPath };
    } catch (error) {
      this.logTtsError(error);
      throw error;
    }
  }

  async getVoices(): Promise<Voice[]> {
    try {
      const response = await fetch(`${this.baseUrl}/audio/voices`);
      if (!response.ok) {
        throw new Error(
          `Failed to fetch Kokoro voices: ${response.status} ${response.statusText}`
        );
      }
      const data = (await response.json()) as { voices: unknown };

      if (!Array.isArray(data.voices)) {
        throw new Error('Kokoro voices response missing a "voices" array');
      }

      return (data.voices as { id: string; name: string }[]).map((voice) => ({
        id: voice.id,
        name: voice.name,
        description: voice.name,
        provider: VocalProviderName.Kokoro,
        providerId: voice.id,
        settings: {},
      }));
    } catch (error) {
      this.logTtsError(error);
      throw error;
    }
  }
}
