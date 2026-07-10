import axios from 'axios';
import * as fs from 'fs-extra';
import * as path from 'path';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { BaseVocalProvider } from './BaseVocalProvider';
import { AiModelFactory } from './AiModelFactory';
import { VocalProviderTtsParams, Voice, VocalProviderName } from '../types';
import { appConfig } from '../utils/config';
import { logger } from '../utils/logger';

const VALID_INLINE_TAGS = ['pause', 'long-pause', 'laugh', 'cry'];
const VALID_WRAPPING_TAGS = ['whisper', 'slow', 'soft'];
const VALID_TAG_PATTERN = new RegExp(
  `\\[(?:${VALID_INLINE_TAGS.join('|')})\\]|</?(?:${VALID_WRAPPING_TAGS.join('|')})>`,
  'g'
);

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
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
      const model = AiModelFactory.getModel(appConfig.defaultAiProvider, 500);
      const response = await model.invoke([
        new SystemMessage(
          "You add expressive speech markup to text for xAI's Grok text-to-speech engine. " +
            "Grok supports exactly two kinds of tags, and ONLY these — do not invent, rename, " +
            "or add any other tag:\n" +
            "- Inline tags: [pause], [long-pause], [laugh], [cry]. Each is a single self-closing " +
            "bracket dropped at a point in the text. Inline tags NEVER have a closing counterpart " +
            "— there is no such thing as [laugh]...[/laugh] or [emphasis]...[/emphasis].\n" +
            "- Wrapping tags: <whisper>...</whisper>, <slow>...</slow>, <soft>...</soft>. Each wraps " +
            "a full phrase in an opening and closing angle-bracket tag, and they can be stacked, " +
            "e.g. <slow><soft>Goodnight.</soft></slow>.\n" +
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
