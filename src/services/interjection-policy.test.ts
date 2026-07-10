import { describe, expect, it } from "vitest";
import {
  INTERJECTION_LENGTH_THRESHOLD,
  shouldInterject,
} from "./interjection-policy";
import { SpeakerAgentToolName } from "../agents/speaker-tools";

describe("shouldInterject", () => {
  it("always interjects when the speech hit the token limit, even if short and the roll is unfavorable", () => {
    const speech = {
      tool: SpeakerAgentToolName.SPEAK,
      message: "short",
      stopReason: "max_tokens" as const,
    };

    expect(shouldInterject(speech, 2, 0.999)).toBe(true);
  });

  it("never interjects on token limit if there is no other speaker to interject", () => {
    const speech = {
      tool: SpeakerAgentToolName.SPEAK,
      message: "short",
      stopReason: "max_tokens" as const,
    };

    expect(shouldInterject(speech, 1, 0)).toBe(false);
  });

  it("falls back to the length-and-chance roll when the speech did not hit the token limit", () => {
    const longMessage = "x".repeat(INTERJECTION_LENGTH_THRESHOLD + 1);
    const longSpeech = {
      tool: SpeakerAgentToolName.SPEAK,
      message: longMessage,
      stopReason: "stop" as const,
    };

    expect(shouldInterject(longSpeech, 2, 0.1)).toBe(true);
    expect(shouldInterject(longSpeech, 2, 0.9)).toBe(false);
  });

  it("does not interject on a short, non-truncated speech regardless of roll", () => {
    const shortSpeech = {
      tool: SpeakerAgentToolName.SPEAK,
      message: "short",
      stopReason: "stop" as const,
    };

    expect(shouldInterject(shortSpeech, 2, 0)).toBe(false);
  });

  it("does not interject on a long non-SPEAK turn regardless of roll", () => {
    const longMessage = "x".repeat(INTERJECTION_LENGTH_THRESHOLD + 1);
    const nonSpeakTurn = {
      tool: SpeakerAgentToolName.QUOTE,
      message: longMessage,
      stopReason: "stop" as const,
    };

    expect(shouldInterject(nonSpeakTurn, 2, 0)).toBe(false);
  });
});
