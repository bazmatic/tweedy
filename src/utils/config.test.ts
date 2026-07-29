import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, parseConversationWorkflowEngine } from "./config";

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
  const originalRuntime = process.env.CONVERSATION_WORKFLOW_ENGINE;
  const originalDataDir = process.env.DATA_DIR;
  const originalStoragePath = process.env.MASTRA_STORAGE_PATH;

  afterEach(() => {
    if (originalRuntime === undefined)
      delete process.env.CONVERSATION_WORKFLOW_ENGINE;
    else process.env.CONVERSATION_WORKFLOW_ENGINE = originalRuntime;
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    if (originalStoragePath === undefined) delete process.env.MASTRA_STORAGE_PATH;
    else process.env.MASTRA_STORAGE_PATH = originalStoragePath;
  });

  it("uses Mastra generation by default", () => {
    delete process.env.CONVERSATION_WORKFLOW_ENGINE;
    expect(loadConfig().conversationWorkflowEngine).toBe("mastra");
  });

  it("selects Mastra explicitly", () => {
    process.env.CONVERSATION_WORKFLOW_ENGINE = "mastra";
    expect(loadConfig().conversationWorkflowEngine).toBe("mastra");
  });

  it("selects legacy explicitly for rollback", () => {
    process.env.CONVERSATION_WORKFLOW_ENGINE = "legacy";
    expect(loadConfig().conversationWorkflowEngine).toBe("legacy");
  });

  it("rejects invalid engine configuration", () => {
    expect(() => parseConversationWorkflowEngine("automatic")).toThrow(
      'Invalid CONVERSATION_WORKFLOW_ENGINE "automatic"'
    );
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
