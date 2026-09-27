import { JudgmentProviderName } from "../types";
import { IJudgmentProvider } from "./judgment-questions";
import { TypeSafeJudgmentProvider } from "./TypeSafeJudgmentProvider";

/** Creates judgment providers; one instance per provider name. */
export class JudgmentProviderFactory {
  private static providers = new Map<JudgmentProviderName, IJudgmentProvider>();

  static getProvider(name: JudgmentProviderName): IJudgmentProvider {
    let provider = this.providers.get(name);
    if (!provider) {
      switch (name) {
        case JudgmentProviderName.TypeSafe:
          provider = new TypeSafeJudgmentProvider();
          break;
        default:
          throw new Error(`Unknown judgment provider: ${name}`);
      }
      this.providers.set(name, provider);
    }
    return provider;
  }
}
