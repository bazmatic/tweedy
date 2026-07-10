import { IResearchProvider, ResearchProviderName } from "../types";
import { PerplexityProvider } from "./PerplexityProvider";

export class ResearchProviderFactory {
  private static providers: Map<ResearchProviderName, IResearchProvider> =
    new Map();

  static getProvider(provider: ResearchProviderName): IResearchProvider {
    if (!this.providers.has(provider)) {
      switch (provider) {
        case ResearchProviderName.Perplexity:
          this.providers.set(provider, new PerplexityProvider());
          break;
        default:
          throw new Error(`Unknown research provider: ${provider}`);
      }
    }

    return this.providers.get(provider)!;
  }
}
