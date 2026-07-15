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
      case AiProviderName.OpenAI:
        // OpenAI's native json_schema mode is strict: every field must be
        // required (plain `.optional()` zod fields are rejected unless also
        // `.nullable()`), which this codebase's schemas don't satisfy.
        // Function calling applies no such restriction.
        return StructuredOutputMethod.FunctionCalling;
      case AiProviderName.Grok:
        return StructuredOutputMethod.FunctionCalling;
      default:
        throw new Error(
          `No structured-output method configured for provider: ${provider}`
        );
    }
  }
}
