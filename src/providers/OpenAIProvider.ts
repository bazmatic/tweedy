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

      const options = params.voice.settings.providerOptions || {};

      const response = await this.client.audio.speech.create({
        model: 'gpt-4o-mini-tts',
        voice: params.voice.providerId as any,
        input: params.speech.message,
        instructions: this.buildInstructions(params),
        response_format: 'mp3',
        ...(options.speed !== undefined ? { speed: options.speed } : {}),
      } as any);

      const buffer = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(outputPath, buffer);
      
      this.logTtsSuccess(outputPath);
      return outputPath;
    } catch (error) {
      this.logTtsError(error);
      throw error;
    }
  }

  // gpt-4o-mini-tts has no memory across requests, so a bare one-line cue (e.g. "skeptical")
  // gets over-acted with nothing to play it against. Anchoring every call to the same
  // conversational baseline, with the per-line cue layered on top, keeps delivery consistent
  // between lines instead of lurching between takes.
  private buildInstructions(params: VocalProviderTtsParams): string {
    const cue = params.speech.instructions?.trim();
    const lines = [
      'Voice Affect: Natural, relaxed podcast co-host — conversational, not theatrical or over-enunciated.',
      'Pacing: Even and unhurried, matching normal spoken conversation.',
    ];
    if (cue) {
      lines.push(`Tone and emotion for this line: ${cue}.`);
    }
    return lines.join('\n');
  }

  async getVoices(): Promise<Voice[]> {
    // OpenAI TTS has predefined voices
    const voices = [
      { id: 'alloy', name: 'Alloy', description: 'Neutral, balanced voice' },
      { id: 'ash', name: 'Ash', description: 'Confident, direct voice' },
      { id: 'ballad', name: 'Ballad', description: 'Smooth, storytelling voice' },
      { id: 'coral', name: 'Coral', description: 'Warm, friendly voice' },
      { id: 'echo', name: 'Echo', description: 'Clear, confident voice' },
      { id: 'fable', name: 'Fable', description: 'Warm, expressive voice' },
      { id: 'onyx', name: 'Onyx', description: 'Deep, authoritative voice' },
      { id: 'nova', name: 'Nova', description: 'Bright, energetic voice' },
      { id: 'sage', name: 'Sage', description: 'Calm, measured voice' },
      { id: 'shimmer', name: 'Shimmer', description: 'Soft, gentle voice' },
      { id: 'verse', name: 'Verse', description: 'Versatile, natural voice' },
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

