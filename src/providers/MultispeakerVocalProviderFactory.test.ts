import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { MultispeakerVocalProviderFactory, isMultispeakerCapable } from "./MultispeakerVocalProviderFactory";
import { VocalProviderName } from "../types";
import { GoogleGeminiMultispeakerProvider } from "./GoogleGeminiMultispeakerProvider";

vi.mock("google-auth-library", () => ({
  GoogleAuth: vi.fn().mockImplementation(function (this: any) {
    return { getClient: vi.fn() };
  }),
}));

describe("isMultispeakerCapable", () => {
  it("returns true for GoogleGeminiMultispeaker and false for a per-clip provider", () => {
    expect(isMultispeakerCapable(VocalProviderName.GoogleGeminiMultispeaker)).toBe(true);
    expect(isMultispeakerCapable(VocalProviderName.GoogleChirp)).toBe(false);
  });
});

describe("MultispeakerVocalProviderFactory", () => {
  const originalCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  beforeEach(() => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/tmp/fake-service-account.json";
  });

  afterEach(() => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = originalCreds;
  });

  it("returns a cached GoogleGeminiMultispeakerProvider instance", () => {
    const provider = MultispeakerVocalProviderFactory.getProvider(
      VocalProviderName.GoogleGeminiMultispeaker
    );
    expect(provider).toBeInstanceOf(GoogleGeminiMultispeakerProvider);
    expect(
      MultispeakerVocalProviderFactory.getProvider(VocalProviderName.GoogleGeminiMultispeaker)
    ).toBe(provider);
  });

  it("throws for a provider with no multispeaker case", () => {
    expect(() => MultispeakerVocalProviderFactory.getProvider(VocalProviderName.GoogleChirp)).toThrow(
      "Unknown multispeaker vocal provider: google_chirp"
    );
  });
});
