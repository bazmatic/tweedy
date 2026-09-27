import { describe, expect, it } from "vitest";
import { JudgmentProviderFactory } from "./JudgmentProviderFactory";
import { TypeSafeJudgmentProvider } from "./TypeSafeJudgmentProvider";
import { JudgmentProviderName } from "../types";

describe("JudgmentProviderFactory", () => {
  it("creates and caches the TypeSafe provider", () => {
    const provider = JudgmentProviderFactory.getProvider(JudgmentProviderName.TypeSafe);
    expect(provider).toBeInstanceOf(TypeSafeJudgmentProvider);
    expect(JudgmentProviderFactory.getProvider(JudgmentProviderName.TypeSafe)).toBe(provider);
  });

  it("throws on an unknown provider", () => {
    expect(() => JudgmentProviderFactory.getProvider("nope" as JudgmentProviderName)).toThrow(/Unknown judgment provider/);
  });
});
