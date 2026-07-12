import { describe, expect, it, vi } from "vitest";
import { MaterialSummarizerAgent } from "./MaterialSummarizerAgent";
import { PodcastMaterial, SourceType } from "../types";

function makeMaterial(overrides: Partial<PodcastMaterial> = {}): PodcastMaterial {
  return {
    id: "m1",
    title: "The Article",
    content: "A".repeat(1000),
    source: "https://example.com/article",
    sourceType: SourceType.Web,
    metadata: {},
    createdAt: new Date(),
    ...overrides,
  };
}

describe("MaterialSummarizerAgent.summarize", () => {
  it("returns the model's summary on success", async () => {
    const agent = new MaterialSummarizerAgent();
    vi.spyOn(agent as any, "callModel").mockResolvedValue(
      "Key fact one. Key fact two. A good angle to debate."
    );

    const result = await agent.summarize(makeMaterial(), {
      title: "Test Podcast",
      description: "A test episode",
    });

    expect(result).toBe(
      "Key fact one. Key fact two. A good angle to debate."
    );
  });

  it("falls back to truncated raw content when the model call fails", async () => {
    const agent = new MaterialSummarizerAgent();
    vi.spyOn(agent as any, "callModel").mockRejectedValue(
      new Error("model unavailable")
    );

    const material = makeMaterial({ content: "B".repeat(1000) });
    const result = await agent.summarize(material, {
      title: "Test Podcast",
      description: "A test episode",
    });

    expect(result).toBe("B".repeat(500));
    expect(result.length).toBe(500);
  });
});
