import axios from 'axios';
import * as fs from 'fs-extra';
import * as path from 'path';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { BaseVocalProvider } from './BaseVocalProvider';
import { AiModelFactory } from './AiModelFactory';
import { VocalProviderTtsParams, Voice, VocalProviderName, TtsResult } from '../types';
import { aggregateWordTimestamps } from './grok-word-timestamps';
import { VALID_TAG_PATTERN } from './grok-effect-tags';
import { appConfig } from '../utils/config';
import { logger } from '../utils/logger';
import { ModelTask } from './ModelRoutingPolicy';

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

interface GrokTtsResponseData {
  audio: string;
  audio_timestamps?: {
    graph_chars: string[];
    graph_times: [number, number][];
  };
}

function hasMidWordTag(tagged: string): boolean {
  const pattern = new RegExp(VALID_TAG_PATTERN.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tagged))) {
    const before = tagged[match.index - 1];
    const after = tagged[match.index + match[0].length];
    if (before && after && /\w/.test(before) && /\w/.test(after)) {
      return true;
    }
  }
  return false;
}

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
      const model = AiModelFactory.getModel(
        appConfig.defaultAiProvider,
        ModelTask.SpeechEffectTagging,
        500
      );
      const response = await model.invoke([
        new SystemMessage(
          "You add expressive speech markup to text for xAI's Grok text-to-speech engine. " +
            "Grok supports exactly two kinds of tags, and ONLY these — do not invent, rename, " +
            "or add any other tag:\n" +
            "- Inline tags — each is a single self-closing bracket dropped at a point in the text, " +
            "and NEVER has a closing counterpart (there is no such thing as [laugh]...[/laugh]):\n" +
            `  Pauses: [pause], [long-pause], [hum-tune]\n` +
            `  Laughter & crying: [laugh], [chuckle], [giggle], [cry]\n` +
            `  Mouth sounds: [tsk], [tongue-click], [lip-smack]\n` +
            `  Breathing: [breath], [inhale], [exhale], [sigh]\n` +
            "- Wrapping tags — each wraps a full phrase in a matching opening and closing " +
            "angle-bracket tag, and they can be stacked, e.g. <slow><soft>Goodnight.</soft></slow>:\n" +
            `  Volume & intensity: <soft>, <whisper>, <loud>, <build-intensity>, <decrease-intensity>\n` +
            `  Pitch & speed: <higher-pitch>, <lower-pitch>, <slow>, <fast>\n` +
            `  Vocal style: <sing-song>, <singing>, <laugh-speak>, <emphasis>\n` +
            "Insert tags naturally and sparingly wherever they fit the tone of the text — do not overuse them. " +
            "Do not change, add, or remove a single word, letter, or punctuation mark of the original text — " +
            "the only thing you may add is tags from the list above. " +
            "Respond with only the tagged text, nothing else — no commentary, no markdown fences."
        ),
        new HumanMessage(text),
      ]);

      const tagged =
        typeof response.content === 'string' ? response.content.trim() : '';
      if (!tagged) return text;

      const strippedOfValidTags = tagged.replace(VALID_TAG_PATTERN, '');
      if (normalizeWhitespace(strippedOfValidTags) !== normalizeWhitespace(text)) {
        logger.warn(
          'Grok effect-tagged text failed validation (malformed tags or altered wording), using original text'
        );
        return text;
      }

      if (hasMidWordTag(tagged)) {
        logger.warn(
          'Grok effect-tagged text failed validation (tag inserted mid-word), using original text'
        );
        return text;
      }

      return tagged;
    } catch (error) {
      logger.warn('Failed to add Grok effect tags, using original text:', error);
      return text;
    }
  }

  async tts(params: VocalProviderTtsParams): Promise<TtsResult> {
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
          with_timestamps: true,
        },
        {
          headers: this.headers,
        }
      );

      const audioBuffer = Buffer.from(response.data.audio, 'base64');
      await fs.writeFile(outputPath, audioBuffer);
      this.logTtsSuccess(outputPath);

      const wordTimestamps = this.extractWordTimestamps(text, response.data as GrokTtsResponseData);

      return wordTimestamps ? { outputPath, wordTimestamps } : { outputPath };
    } catch (error) {
      this.logTtsError(error);
      throw error;
    }
  }

  private extractWordTimestamps(
    text: string,
    responseData: GrokTtsResponseData
  ): ReturnType<typeof aggregateWordTimestamps> | undefined {
    const timestamps = responseData?.audio_timestamps;
    if (
      !timestamps ||
      !Array.isArray(timestamps.graph_chars) ||
      !Array.isArray(timestamps.graph_times)
    ) {
      logger.warn('Grok TTS response missing audio_timestamps, skipping word timestamps');
      return undefined;
    }
    try {
      return aggregateWordTimestamps(text, timestamps.graph_chars, timestamps.graph_times);
    } catch (error) {
      logger.warn('Failed to aggregate Grok word timestamps, skipping:', error);
      return undefined;
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
