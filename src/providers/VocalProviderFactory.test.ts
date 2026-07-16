import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { VocalProviderFactory } from "./VocalProviderFactory";
import { VocalProviderName } from "../types";
import { GoogleChirpProvider } from "./GoogleChirpProvider";

vi.mock("google-auth-library", () => ({
  GoogleAuth: vi.fn().mockImplementation(function (this: any) {
    return {
      getClient: vi.fn().mockResolvedValue({
        getAccessToken: vi.fn().mockResolvedValue({ token: "test-access-token" }),
      }),
    };
  }),
}));

describe("VocalProviderFactory", () => {
  const originalCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  beforeEach(() => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/tmp/fake-service-account.json";
  });

  afterEach(() => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = originalCreds;
  });

  it("returns a GoogleChirpProvider instance for VocalProviderName.GoogleChirp", () => {
    const provider = VocalProviderFactory.getProvider(VocalProviderName.GoogleChirp);
    expect(provider).toBeInstanceOf(GoogleChirpProvider);
  });
});
