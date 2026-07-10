import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";
import { PerplexityProvider } from "./PerplexityProvider";
import { SourceType } from "../types";

const mockProcess = vi.fn();

vi.mock("axios");
vi.mock("../processors", () => ({
  HTMLProcessor: vi.fn().mockImplementation(function (this: any) {
    this.process = mockProcess;
  }),
}));

describe("PerplexityProvider", () => {
  const originalKey = process.env.PERPLEXITY_API_KEY;

  beforeEach(() => {
    process.env.PERPLEXITY_API_KEY = "test-key";
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.PERPLEXITY_API_KEY = originalKey;
  });

  it("throws if PERPLEXITY_API_KEY is missing", () => {
    delete process.env.PERPLEXITY_API_KEY;
    expect(() => new PerplexityProvider()).toThrow(
      "PERPLEXITY_API_KEY environment variable is required"
    );
  });

  it("returns one Research material for the answer plus one Web material per citation", async () => {
    (axios.post as any).mockResolvedValue({
      data: {
        choices: [{ message: { content: "The synthesized answer." } }],
        citations: ["https://example.com/a", "https://example.com/b"],
        usage: { total_tokens: 42 },
      },
    });

    mockProcess
      .mockResolvedValueOnce({
        title: "Page A",
        content: "Content A",
        metadata: {},
      })
      .mockResolvedValueOnce({
        title: "Page B",
        content: "Content B",
        metadata: {},
      });

    const provider = new PerplexityProvider();
    const results = await provider.research("what is X?");

    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({
      title: "what is X?",
      content: "The synthesized answer.",
      source: "perplexity",
      sourceType: SourceType.Research,
    });
    expect(results[0].metadata.citations).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
    expect(results[1]).toMatchObject({
      title: "Page A",
      content: "Content A",
      source: "https://example.com/a",
      sourceType: SourceType.Web,
    });
    expect(results[2]).toMatchObject({
      title: "Page B",
      content: "Content B",
      source: "https://example.com/b",
      sourceType: SourceType.Web,
    });
  });

  it("skips a citation that fails to fetch instead of throwing", async () => {
    (axios.post as any).mockResolvedValue({
      data: {
        choices: [{ message: { content: "The answer." } }],
        citations: ["https://example.com/dead", "https://example.com/ok"],
        usage: {},
      },
    });

    mockProcess
      .mockRejectedValueOnce(new Error("404"))
      .mockResolvedValueOnce({
        title: "Page OK",
        content: "Content OK",
        metadata: {},
      });

    const provider = new PerplexityProvider();
    const results = await provider.research("query");

    expect(results).toHaveLength(2);
    expect(results[1]).toMatchObject({
      title: "Page OK",
      source: "https://example.com/ok",
    });
  });

  it("throws a sanitized error and never leaks the API key when the Perplexity API call fails", async () => {
    const axiosError = new Error("Request failed with status code 401") as any;
    axiosError.config = {
      headers: {
        Authorization: "Bearer test-key",
      },
    };
    (axios.post as any).mockRejectedValue(axiosError);

    const provider = new PerplexityProvider();

    await expect(provider.research("query")).rejects.toThrow();

    try {
      await provider.research("query");
      throw new Error("expected research() to throw");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("test-key");
      expect(message).not.toContain("Authorization");
    }
  });
});
