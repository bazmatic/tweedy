import { IVocalProvider, VocalProviderName } from '../types';
import { ElevenLabsProvider } from './ElevenLabsProvider';
import { OpenAIProvider } from './OpenAIProvider';
import { logger } from '../utils/logger';

export class VocalProviderFactory {
  private static providers: Map<VocalProviderName, IVocalProvider> = new Map();

  static getProvider(provider: VocalProviderName): IVocalProvider {
    if (!this.providers.has(provider)) {
      switch (provider) {
        case VocalProviderName.ElevenLabs:
          this.providers.set(provider, new ElevenLabsProvider());
          break;
        case VocalProviderName.OpenAI:
          this.providers.set(provider, new OpenAIProvider());
          break;
        case VocalProviderName.Hume:
          throw new Error('Hume provider not implemented yet');
        default:
          throw new Error(`Unknown vocal provider: ${provider}`);
      }
    }

    return this.providers.get(provider)!;
  }

  static async getAvailableProviders(): Promise<VocalProviderName[]> {
    const available: VocalProviderName[] = [];
    
    for (const provider of Object.values(VocalProviderName)) {
      try {
        const instance = this.getProvider(provider);
        await instance.getVoices();
        available.push(provider);
      } catch (error) {
        logger.warn(`Provider ${provider} not available:`, error);
      }
    }
    
    return available;
  }
}

