import { describe, expect, it } from "vitest";
import { checkMultispeakerEligibility } from "./multispeaker-eligibility";
import { VocalProviderName } from "../types";
import type { Speech, Speaker, Voice } from "../types";

function makeVoice(provider: VocalProviderName): Voice {
  return { id: "v", name: "v", description: "", provider, providerId: "v", settings: {} };
}

function makeSpeaker(id: string, name: string, voice: Voice): Speaker {
  return { id, slug: id, name, personality: "curious", voice, voiceStyle: "neutral", isExpert: false };
}

function makeSpeech(speaker: Speaker, message: string): Speech {
  return {
    id: `${speaker.id}-${message}`,
    speaker,
    message,
    instructions: "",
    voice: speaker.voice,
    voiceStyle: "neutral",
    timestamp: new Date(),
  };
}

describe("checkMultispeakerEligibility", () => {
  it("is eligible when exactly 2 speakers share the same multispeaker-capable provider", () => {
    const a = makeSpeaker("sp1", "Ada", makeVoice(VocalProviderName.GoogleGeminiMultispeaker));
    const b = makeSpeaker("sp2", "Bo", makeVoice(VocalProviderName.GoogleGeminiMultispeaker));
    const result = checkMultispeakerEligibility([makeSpeech(a, "hi"), makeSpeech(b, "hey")]);
    expect(result).toEqual({ eligible: true, provider: VocalProviderName.GoogleGeminiMultispeaker });
  });

  it("is ineligible with no warning when 2 speakers share a non-multispeaker provider", () => {
    const a = makeSpeaker("sp1", "Ada", makeVoice(VocalProviderName.ElevenLabs));
    const b = makeSpeaker("sp2", "Bo", makeVoice(VocalProviderName.ElevenLabs));
    const result = checkMultispeakerEligibility([makeSpeech(a, "hi"), makeSpeech(b, "hey")]);
    expect(result).toEqual({ eligible: false });
  });

  it("is ineligible with a warning naming the mismatched speaker when providers differ", () => {
    const a = makeSpeaker("sp1", "Ada", makeVoice(VocalProviderName.GoogleGeminiMultispeaker));
    const b = makeSpeaker("sp2", "Bo", makeVoice(VocalProviderName.ElevenLabs));
    const result = checkMultispeakerEligibility([makeSpeech(a, "hi"), makeSpeech(b, "hey")]);
    expect(result.eligible).toBe(false);
    expect(result.warning).toContain("Bo");
    expect(result.warning).toContain(VocalProviderName.ElevenLabs);
  });

  it("is ineligible with no warning when there are 3 or more speakers", () => {
    const a = makeSpeaker("sp1", "Ada", makeVoice(VocalProviderName.GoogleGeminiMultispeaker));
    const b = makeSpeaker("sp2", "Bo", makeVoice(VocalProviderName.GoogleGeminiMultispeaker));
    const c = makeSpeaker("sp3", "Cy", makeVoice(VocalProviderName.GoogleGeminiMultispeaker));
    const result = checkMultispeakerEligibility([
      makeSpeech(a, "hi"),
      makeSpeech(b, "hey"),
      makeSpeech(c, "yo"),
    ]);
    expect(result).toEqual({ eligible: false });
  });
});
