import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("fs-extra", () => ({
  pathExists: vi.fn(),
  readdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  remove: vi.fn(),
  ensureDir: vi.fn(),
}));

import * as fs from "fs-extra";
import { SpeechRepository } from "./SpeechRepository";

const speech = {
  speakerId: "speaker-1",
  message: "Hello",
  instructions: "warm",
  voiceId: "voice-1",
  voiceStyle: "natural",
  timestamp: new Date("2026-07-27T00:00:00.000Z"),
};

describe("SpeechRepository idempotency", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the existing record for a replay instead of creating a duplicate", async () => {
    const existing = { id: "speech-1", idempotencyKey: "ep/run/0/speech", ...speech };
    (fs.pathExists as any).mockResolvedValue(true);
    (fs.readdir as any).mockResolvedValue(["speech-1.json"]);
    (fs.readFile as any).mockResolvedValue(JSON.stringify(existing));

    const repository = new SpeechRepository();
    const result = await repository.createOrReturn(speech, "ep/run/0/speech");

    expect(result).toEqual(expect.objectContaining({ id: "speech-1" }));
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("creates a keyed record when this logical turn has not been persisted", async () => {
    (fs.pathExists as any).mockResolvedValue(false);
    (fs.writeFile as any).mockResolvedValue(undefined);
    const repository = new SpeechRepository();

    const result = await repository.createOrReturn(speech, "ep/run/0/interjection");

    expect(result.idempotencyKey).toBe("ep/run/0/interjection");
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
  });

  it("cleans up only unaccepted keyed records", async () => {
    const existing = { id: "speech-1", idempotencyKey: "ep/run/0/speech", ...speech };
    (fs.pathExists as any).mockResolvedValue(true);
    (fs.readdir as any).mockResolvedValue(["speech-1.json"]);
    (fs.readFile as any).mockResolvedValue(JSON.stringify(existing));
    (fs.remove as any).mockResolvedValue(undefined);
    const repository = new SpeechRepository();

    expect(await repository.deleteUnaccepted(existing.idempotencyKey, ["speech-1"])).toBe(false);
    expect(await repository.deleteUnaccepted(existing.idempotencyKey, [])).toBe(true);
    expect(fs.remove).toHaveBeenCalledTimes(1);
  });
});
