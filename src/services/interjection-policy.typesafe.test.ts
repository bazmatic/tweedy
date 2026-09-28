import { describe, expect, it } from "vitest";
import { calibrate, decideInterjection } from "./interjection-policy";
import { setJudgmentProvider } from "./judgment-runtime";
import { scriptedProvider, unavailableProvider } from "../test-support/judgments";
import { SpeakerAgentToolName } from "../agents/speaker-tools";

const turn = (message: string, overrides = {}) => ({
  speaker: { name: "Ben" } as any,
  message,
  tool: SpeakerAgentToolName.SPEAK,
  ...overrides,
});
const naturalness = (probability: number) =>
  scriptedProvider(() => ({ type: "noul", probability }));

describe("decideInterjection", () => {
  it("never interjects on a solo show, always after truncation, without asking", async () => {
    const provider = naturalness(0.9);
    setJudgmentProvider(provider);
    expect(await decideInterjection(turn("x"), 1, 0)).toBe(false);
    expect(await decideInterjection(turn("cut off—", { stopReason: "max_tokens" }), 2, 0.99)).toBe(true);
    expect(provider.calls).toEqual([]);
  });

  it("samples the calibrated probability with the roll", async () => {
    setJudgmentProvider(naturalness(0.9)); // calibrate(0.9) = 0.8
    expect(await decideInterjection(turn("wild detail"), 2, 0.79)).toBe(true);
    expect(await decideInterjection(turn("wild detail"), 2, 0.81)).toBe(false);
  });

  it("does not interject when the provider is unavailable", async () => {
    setJudgmentProvider(unavailableProvider());
    expect(await decideInterjection(turn("wild detail"), 2, 0)).toBe(false);
  });

  it("calibrates 0.5 and below to never", () => {
    expect(calibrate(0.5)).toBe(0);
    expect(calibrate(0.3)).toBe(0);
    expect(calibrate(1)).toBe(1);
  });
});
