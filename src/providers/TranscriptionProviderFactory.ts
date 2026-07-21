import { IWhisperTranscriptionProvider, TranscriptionProviderName } from "../types";
import { OpenAIWhisperProvider } from "./OpenAIWhisperProvider";

export class TranscriptionProviderFactory {
  private static providers: Map<TranscriptionProviderName, IWhisperTranscriptionProvider> =
    new Map();

  static getProvider(provider: TranscriptionProviderName): IWhisperTranscriptionProvider {
    if (!this.providers.has(provider)) {
      switch (provider) {
        case TranscriptionProviderName.OpenAIWhisper:
          this.providers.set(provider, new OpenAIWhisperProvider());
          break;
        default:
          throw new Error(`Unknown transcription provider: ${provider}`);
      }
    }

    return this.providers.get(provider)!;
  }
}
