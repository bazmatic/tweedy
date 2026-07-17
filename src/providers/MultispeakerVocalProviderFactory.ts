import { IMultispeakerVocalProvider, VocalProviderName } from "../types";
import { GoogleGeminiMultispeakerProvider } from "./GoogleGeminiMultispeakerProvider";

const MULTISPEAKER_PROVIDERS = new Set<VocalProviderName>([
  VocalProviderName.GoogleGeminiMultispeaker,
]);

export function isMultispeakerCapable(provider: VocalProviderName): boolean {
  return MULTISPEAKER_PROVIDERS.has(provider);
}

export class MultispeakerVocalProviderFactory {
  private static providers: Map<VocalProviderName, IMultispeakerVocalProvider> = new Map();

  static getProvider(provider: VocalProviderName): IMultispeakerVocalProvider {
    if (!this.providers.has(provider)) {
      switch (provider) {
        case VocalProviderName.GoogleGeminiMultispeaker:
          this.providers.set(provider, new GoogleGeminiMultispeakerProvider());
          break;
        default:
          throw new Error(`Unknown multispeaker vocal provider: ${provider}`);
      }
    }

    return this.providers.get(provider)!;
  }
}
