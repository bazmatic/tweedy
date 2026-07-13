import { IVocalProvider, VocalProviderName } from '../types';
import { ElevenLabsProvider } from './ElevenLabsProvider';
import { ElevenLabsV3Provider } from './ElevenLabsV3Provider';
import { OpenAIProvider } from './OpenAIProvider';
import { HumeProvider } from './HumeProvider';
import { CartesiaProvider } from './CartesiaProvider';
import { KokoroProvider } from './KokoroProvider';
import { GrokProvider } from './GrokProvider';
import { logger } from '../utils/logger';

export class VocalProviderFactory {
  private static providers: Map<VocalProviderName, IVocalProvider> = new Map();

  static getProvider(provider: VocalProviderName): IVocalProvider {
    if (!this.providers.has(provider)) {
      switch (provider) {
        case VocalProviderName.ElevenLabs:
          this.providers.set(provider, new ElevenLabsProvider());
          break;
        case VocalProviderName.ElevenLabsV3:
          this.providers.set(provider, new ElevenLabsV3Provider());
          break;
        case VocalProviderName.OpenAI:
          this.providers.set(provider, new OpenAIProvider());
          break;
        case VocalProviderName.Hume:
          this.providers.set(provider, new HumeProvider());
          break;
        case VocalProviderName.Cartesia:
          this.providers.set(provider, new CartesiaProvider());
          break;
        case VocalProviderName.Kokoro:
          this.providers.set(provider, new KokoroProvider());
          break;
        case VocalProviderName.Grok:
          this.providers.set(provider, new GrokProvider());
          break;
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

