import { IVocalProvider, VocalProviderTtsParams, TtsResult, Voice } from '../types';
import { logger } from '../utils/logger';

export abstract class BaseVocalProvider implements IVocalProvider {
  protected abstract getProviderName(): string;

  abstract tts(params: VocalProviderTtsParams): Promise<TtsResult>;
  abstract getVoices(): Promise<Voice[]>;

  protected validateParams(params: VocalProviderTtsParams): void {
    if (!params.speech) {
      throw new Error('Speech is required');
    }
    if (!params.voice) {
      throw new Error('Voice is required');
    }
    if (!params.outputFileName) {
      throw new Error('Output filename is required');
    }
  }

  protected logTtsRequest(params: VocalProviderTtsParams): void {
    logger.debug(`TTS request to ${this.getProviderName()}:`, {
      speechLength: params.speech.message.length,
      voice: params.voice.name,
      outputFile: params.outputFileName,
    });
  }

  protected logTtsSuccess(outputFile: string): void {
    logger.info(`TTS completed successfully: ${outputFile}`);
  }

  protected logTtsError(error: any): void {
    logger.error(`TTS failed for ${this.getProviderName()}:`, error);
  }
}

