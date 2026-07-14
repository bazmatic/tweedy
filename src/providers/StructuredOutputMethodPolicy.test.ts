import { describe, expect, it } from "vitest";
import { AiProviderName } from "../types";
import {
  StructuredOutputMethod,
  StructuredOutputMethodPolicy,
} from "./StructuredOutputMethodPolicy";

describe("StructuredOutputMethodPolicy", () => {
  const policy = new StructuredOutputMethodPolicy();

  it("uses Anthropic native JSON schema output", () => {
    expect(policy.resolve(AiProviderName.Anthropic)).toBe(
      StructuredOutputMethod.JsonSchema
    );
  });

  it("uses LangChain's compatible function-calling strategy for DeepSeek", () => {
    expect(policy.resolve(AiProviderName.DeepSeek)).toBe(
      StructuredOutputMethod.FunctionCalling
    );
  });
});
