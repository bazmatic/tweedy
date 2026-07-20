import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config";

describe("loadConfig multispeakerChunkSize", () => {
  const original = process.env.MULTISPEAKER_CHUNK_SIZE;

  beforeEach(() => {
    delete process.env.MULTISPEAKER_CHUNK_SIZE;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.MULTISPEAKER_CHUNK_SIZE;
    else process.env.MULTISPEAKER_CHUNK_SIZE = original;
  });

  it("defaults to undefined when MULTISPEAKER_CHUNK_SIZE is unset", () => {
    expect(loadConfig().multispeakerChunkSize).toBeUndefined();
  });

  it("parses MULTISPEAKER_CHUNK_SIZE into a number when set", () => {
    process.env.MULTISPEAKER_CHUNK_SIZE = "5";
    expect(loadConfig().multispeakerChunkSize).toBe(5);
  });
});
