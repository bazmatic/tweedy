import axios from 'axios';
import * as fs from 'fs-extra';
import * as path from 'path';
import { ElevenLabsProvider } from './ElevenLabsProvider';
import { VocalProviderTtsParams, TtsResult } from '../types';
import { appConfig } from '../utils/config';

const STABILITY_PRESETS = {
  creative: 0.0,
  natural: 0.5,
  robust: 1.0,
} as const;

type StabilityPreset = keyof typeof STABILITY_PRESETS;

export class ElevenLabsV3Provider extends ElevenLabsProvider {
  protected getProviderName(): string {
    return 'ElevenLabsV3';
  }

  async tts(params: VocalProviderTtsParams): Promise<TtsResult> {
    this.validateParams(params);
    this.logTtsRequest(params);

    try {
      const outputPath = path.join(appConfig.audioDir, params.outputFileName);
      await fs.ensureDir(path.dirname(outputPath));

      const preset = (params.voice.settings.providerOptions?.stabilityPreset as
        | StabilityPreset
        | undefined) ?? 'creative';

      // eleven_v3 is alpha: voice_settings only accepts `stability` (as one of
      // three presets) and `use_speaker_boost`. Unlike v1/v2 it has no `seed`,
      // no `previous_text`/`next_text` stitching, and no `speed` control, so
      // those are omitted entirely rather than sent and ignored. This shape
      // is best-effort pending verification against the live API.
      const response = await axios.post(
        `${this.baseUrl}/text-to-speech/${params.voice.providerId}`,
        {
          text: params.speech.message,
          model_id: 'eleven_v3',
          voice_settings: {
            stability: STABILITY_PRESETS[preset],
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
}
