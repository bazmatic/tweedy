import axios from 'axios';
import * as fs from 'fs-extra';
import * as path from 'path';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { BaseVocalProvider } from './BaseVocalProvider';
import { AiModelFactory } from './AiModelFactory';
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

  private async addEffectTags(text: string): Promise<string> {
    try {
      const model = AiModelFactory.getModel(appConfig.defaultAiProvider, 500);
      const response = await model.invoke([
        new SystemMessage(
          "You add expressive speech markup to text for xAI's Grok text-to-speech engine. " +
            "Grok supports two kinds of tags: inline tags like [pause], [long-pause], [laugh], [cry], " +
            "placed at a point in the text to trigger an expression; and wrapping tags like " +
            "<whisper>...</whisper>, <slow>...</slow>, <soft>...</soft>, which enclose a phrase to change " +
            "its delivery style and can be stacked, e.g. <slow><soft>Goodnight.</soft></slow>. " +
            "Insert tags naturally and sparingly wherever they fit the tone of the text — do not overuse them. " +
            "Never change the wording of the text itself. " +
            "Respond with only the tagged text, nothing else — no commentary, no markdown fences."
        ),
        new HumanMessage(text),
      ]);

      const tagged =
        typeof response.content === 'string' ? response.content.trim() : '';
      return tagged || text;
    } catch (error) {
      logger.warn('Failed to add Grok effect tags, using original text:', error);
      return text;
    }
  }

  async tts(params: VocalProviderTtsParams): Promise<string> {
    this.validateParams(params);
    this.logTtsRequest(params);

    try {
      const outputPath = path.join(appConfig.audioDir, params.outputFileName);
      await fs.ensureDir(path.dirname(outputPath));

      const options = params.voice.settings.providerOptions || {};
      const text = await this.addEffectTags(params.speech.message);

      const response = await axios.post(
        `${this.baseUrl}/tts`,
        {
          text,
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

      const voices = response.data.voices ?? response.data.data ?? response.data;

      return voices.map((voice: any) => ({
        id: voice.voice_id ?? voice.id,
        name: voice.name,
        description: voice.description || voice.name,
        provider: VocalProviderName.Grok,
        providerId: voice.voice_id ?? voice.id,
        settings: {},
      }));
    } catch (error) {
      logger.error('Failed to get Grok voices:', error);
      throw error;
    }
  }
}
