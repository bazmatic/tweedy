import { afterEach, describe, expect, it } from "vitest";
import { getJudgmentProvider, setJudgmentProvider } from "./judgment-runtime";
import { JudgmentProviderFactory } from "../providers/JudgmentProviderFactory";
import { JudgmentProviderName } from "../types";
import { unavailableProvider } from "../test-support/judgments";

describe("getJudgmentProvider / setJudgmentProvider", () => {
  afterEach(() => {
    // Restore the global test setup's default so later tests are unaffected.
    setJudgmentProvider(unavailableProvider());
  });

  it("returns the override installed via setJudgmentProvider", () => {
    const mock = unavailableProvider();
    setJudgmentProvider(mock);
    expect(getJudgmentProvider()).toBe(mock);
  });

  it("falls back to the factory's TypeSafe instance once the override is cleared", () => {
    setJudgmentProvider(undefined);
    expect(getJudgmentProvider()).toBe(
      JudgmentProviderFactory.getProvider(JudgmentProviderName.TypeSafe)
    );
  });

  it("is unavailable by default, per the global test setup", async () => {
    const result = await getJudgmentProvider().judge({}, {});
    expect(result).toEqual({ status: "unavailable", reason: "no provider in tests" });
  });
});
