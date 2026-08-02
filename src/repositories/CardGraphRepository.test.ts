import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("fs-extra", () => ({
  pathExists: vi.fn(),
  readdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  remove: vi.fn(),
  ensureDir: vi.fn(),
}));

import * as fs from "fs-extra";
import { CardGraphRepository } from "./CardGraphRepository";
import { CardRelationType } from "../types";

describe("CardGraphRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fs.ensureDir as any).mockResolvedValue(undefined);
    (fs.writeFile as any).mockResolvedValue(undefined);
  });

  it("creates an edge with a generated id and persists it as flat JSON", async () => {
    const repository = new CardGraphRepository();

    const saved = await repository.create({
      scriptId: "script-1",
      cardIds: ["m1-card-1", "m2-card-3"],
      relationType: CardRelationType.SharesConcept,
      rationale: "Both describe the same mechanism.",
      weight: 0.81,
    });

    expect(saved.id).toBeTruthy();
    expect(saved.scriptId).toBe("script-1");
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining(`card-graph/${saved.id}.json`),
      expect.any(String)
    );
  });

  it("finds edges by scriptId and cardId, ignoring edges from other scripts", async () => {
    (fs.pathExists as any).mockResolvedValue(true);
    (fs.readdir as any).mockResolvedValue(["a.json", "b.json"]);
    (fs.readFile as any).mockImplementation((filePath: string) => {
      if (filePath.endsWith("a.json")) {
        return Promise.resolve(
          JSON.stringify({
            id: "a",
            scriptId: "script-1",
            cardIds: ["m1-card-1", "m2-card-3"],
            relationType: CardRelationType.SharesConcept,
            rationale: "r",
            weight: 0.8,
          })
        );
      }
      return Promise.resolve(
        JSON.stringify({
          id: "b",
          scriptId: "script-2",
          cardIds: ["m1-card-1", "m9-card-1"],
          relationType: CardRelationType.Contrasts,
          rationale: "r2",
          weight: 0.7,
        })
      );
    });

    const repository = new CardGraphRepository();
    const found = await repository.findByCardId("script-1", "m1-card-1");

    expect(found).toHaveLength(1);
    expect(found[0].id).toBe("a");
  });
});
