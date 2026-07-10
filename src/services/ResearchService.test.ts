import { describe, expect, it, vi, beforeEach } from "vitest";
import { ResearchService } from "./ResearchService";
import { ResearchProviderFactory } from "../providers";
import { SourceType, ResearchProviderName } from "../types";

vi.mock("../providers", () => ({
  ResearchProviderFactory: {
    getProvider: vi.fn(),
  },
}));

function makeMaterialService(addMaterial: any) {
  return { addMaterial } as any;
}

describe("ResearchService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists each ResearchMaterial via MaterialService.addMaterial", async () => {
    const research = vi.fn().mockResolvedValue([
      {
        title: "The Answer",
        content: "Answer content",
        source: "perplexity",
        sourceType: SourceType.Research,
        metadata: { citations: ["https://example.com"] },
      },
      {
        title: "Page A",
        content: "Content A",
        source: "https://example.com",
        sourceType: SourceType.Web,
        metadata: {},
      },
    ]);
    (ResearchProviderFactory.getProvider as any).mockReturnValue({ research });

    const addMaterial = vi.fn().mockImplementation((m) =>
      Promise.resolve({ id: "id-1", createdAt: new Date(), ...m })
    );
    const materialService = makeMaterialService(addMaterial);

    const service = new ResearchService(materialService);
    const results = await service.research("what is X?");

    expect(ResearchProviderFactory.getProvider).toHaveBeenCalledWith(
      ResearchProviderName.Perplexity
    );
    expect(research).toHaveBeenCalledWith("what is X?");
    expect(addMaterial).toHaveBeenCalledTimes(2);
    expect(addMaterial).toHaveBeenNthCalledWith(1, {
      title: "The Answer",
      content: "Answer content",
      source: "perplexity",
      sourceType: SourceType.Research,
      metadata: { citations: ["https://example.com"] },
    });
    expect(results).toHaveLength(2);
  });

  it("prefixes material titles with namePrefix when provided", async () => {
    const research = vi.fn().mockResolvedValue([
      {
        title: "The Answer",
        content: "Answer content",
        source: "perplexity",
        sourceType: SourceType.Research,
        metadata: {},
      },
    ]);
    (ResearchProviderFactory.getProvider as any).mockReturnValue({ research });

    const addMaterial = vi.fn().mockImplementation((m) =>
      Promise.resolve({ id: "id-1", createdAt: new Date(), ...m })
    );
    const materialService = makeMaterialService(addMaterial);

    const service = new ResearchService(materialService);
    await service.research("what is X?", "Frisbee history");

    expect(addMaterial).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Frisbee history: The Answer" })
    );
  });
});
