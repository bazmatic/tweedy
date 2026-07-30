import { describe, expect, it, vi } from "vitest";
import { EmbeddingService } from "../types";
import { DiscourseRoleMatcher } from "./DiscourseRoleMatcher";

describe("DiscourseRoleMatcher", () => {
  it("returns canonical labels without embedding them", async () => {
    const embeddings: EmbeddingService = {
      embedText: vi.fn(),
      embedDocuments: vi.fn(),
    };
    const matcher = new DiscourseRoleMatcher(embeddings);

    await expect(matcher.match(" Context ")).resolves.toBe("context");
    expect(embeddings.embedText).not.toHaveBeenCalled();
  });

  it("maps an arbitrary label to the nearest canonical role embedding", async () => {
    const roleVectors = Array.from({ length: 11 }, () => [0, 1]);
    roleVectors[9] = [1, 0];
    const embeddings: EmbeddingService = {
      embedText: vi.fn().mockResolvedValue([1, 0]),
      embedDocuments: vi.fn().mockResolvedValue(roleVectors),
    };
    const matcher = new DiscourseRoleMatcher(embeddings);

    await expect(matcher.match("downstream repercussion")).resolves.toBe(
      "implication"
    );
  });

  it("fails gracefully when embeddings are unavailable", async () => {
    const embeddings: EmbeddingService = {
      embedText: vi.fn().mockRejectedValue(new Error("offline")),
      embedDocuments: vi.fn().mockRejectedValue(new Error("offline")),
    };
    const matcher = new DiscourseRoleMatcher(embeddings);

    await expect(matcher.match("unprecedented label")).resolves.toBe(
      "proposition"
    );
  });
});
