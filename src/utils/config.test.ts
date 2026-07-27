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

describe("loadConfig Mastra runtime", () => {
  const originalRuntime = process.env.CONVERSATION_RUNTIME;
  const originalDataDir = process.env.DATA_DIR;
  const originalStoragePath = process.env.MASTRA_STORAGE_PATH;

  afterEach(() => {
    if (originalRuntime === undefined) delete process.env.CONVERSATION_RUNTIME;
    else process.env.CONVERSATION_RUNTIME = originalRuntime;
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    if (originalStoragePath === undefined) delete process.env.MASTRA_STORAGE_PATH;
    else process.env.MASTRA_STORAGE_PATH = originalStoragePath;
  });

  it("keeps legacy generation as the default", () => {
    delete process.env.CONVERSATION_RUNTIME;
    expect(loadConfig().conversationRuntime).toBe("legacy");
  });

  it("places workflow storage under DATA_DIR by default", () => {
    process.env.DATA_DIR = "/tmp/tweedy-data";
    delete process.env.MASTRA_STORAGE_PATH;
    expect(loadConfig().mastraStoragePath).toBe("/tmp/tweedy-data/mastra.db");
  });

  it("accepts an explicit workflow storage path", () => {
    process.env.MASTRA_STORAGE_PATH = "/tmp/workflows.db";
    expect(loadConfig().mastraStoragePath).toBe("/tmp/workflows.db");
  });
});
