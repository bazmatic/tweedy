import { AiProviderName } from "../types";

export enum StructuredOutputMethod {
  FunctionCalling = "functionCalling",
  JsonSchema = "jsonSchema",
}

/** Selects the most reliable structured-output transport for each provider. */
export class StructuredOutputMethodPolicy {
  resolve(provider: AiProviderName): StructuredOutputMethod {
    switch (provider) {
      case AiProviderName.Anthropic:
        return StructuredOutputMethod.JsonSchema;
      case AiProviderName.DeepSeek:
        return StructuredOutputMethod.FunctionCalling;
      default:
        throw new Error(
          `No structured-output method configured for provider: ${provider}`
        );
    }
  }
}
