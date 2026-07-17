import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { VocalProviderFactory, MultispeakerVocalProviderFactory, isMultispeakerCapable } from "../../providers";
import { VocalProviderName } from "../../types";
import { GoogleGeminiMultispeakerProvider } from "../../providers/GoogleGeminiMultispeakerProvider";

// Mirrors the resolveVoiceLister helper in VoiceCommands.ts: dispatches to
// whichever factory actually implements the requested provider.
function resolveVoiceLister(provider: VocalProviderName) {
  return isMultispeakerCapable(provider)
    ? MultispeakerVocalProviderFactory.getProvider(provider)
    : VocalProviderFactory.getProvider(provider);
}

describe("VoiceCommands import provider resolution", () => {
  const originalCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  beforeEach(() => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/tmp/fake-service-account.json";
  });

  afterEach(() => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = originalCreds;
  });

  it("resolves a multispeaker-capable provider via MultispeakerVocalProviderFactory without throwing", () => {
    const provider = resolveVoiceLister(VocalProviderName.GoogleGeminiMultispeaker);
    expect(provider).toBeInstanceOf(GoogleGeminiMultispeakerProvider);
  });

  it("resolves a standard provider via VocalProviderFactory", () => {
    const provider = resolveVoiceLister(VocalProviderName.ElevenLabs);
    expect(provider).toBeDefined();
    expect(provider).not.toBeInstanceOf(GoogleGeminiMultispeakerProvider);
  });

  it("does not throw 'Unknown vocal provider' for google_gemini_multispeaker", () => {
    expect(() => resolveVoiceLister(VocalProviderName.GoogleGeminiMultispeaker)).not.toThrow();
  });
});
