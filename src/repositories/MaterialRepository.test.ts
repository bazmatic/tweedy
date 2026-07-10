import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("fs-extra", () => ({
  pathExists: vi.fn(),
  readdir: vi.fn(),
  readFile: vi.fn(),
  remove: vi.fn(),
  ensureDir: vi.fn(),
}));

import * as fs from "fs-extra";
import { MaterialRepository } from "./MaterialRepository";
import { SourceType } from "../types";

function makeRecordJson(id: string) {
  return JSON.stringify({
    id,
    title: `Title ${id}`,
    content: "content",
    source: "source",
    sourceType: SourceType.Manual,
    metadata: {},
    createdAt: new Date().toISOString(),
  });
}

describe("MaterialRepository.deleteAll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes every existing material record and returns the count", async () => {
    (fs.pathExists as any).mockResolvedValue(true);
    (fs.readdir as any).mockResolvedValue(["a.json", "b.json"]);
    (fs.readFile as any).mockImplementation((filePath: string) => {
      const id = filePath.includes("a.json") ? "a" : "b";
      return Promise.resolve(makeRecordJson(id));
    });
    (fs.remove as any).mockResolvedValue(undefined);

    const repository = new MaterialRepository();
    const count = await repository.deleteAll();

    expect(count).toBe(2);
    expect(fs.remove).toHaveBeenCalledTimes(2);
  });

  it("returns 0 when there are no material records", async () => {
    (fs.pathExists as any).mockResolvedValue(false);

    const repository = new MaterialRepository();
    const count = await repository.deleteAll();

    expect(count).toBe(0);
    expect(fs.remove).not.toHaveBeenCalled();
  });
});
