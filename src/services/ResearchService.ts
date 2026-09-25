import { MaterialService } from "./MaterialService";
import { ResearchProviderFactory } from "../providers";
import { PodcastMaterial, ResearchOptions, ResearchProviderName } from "../types";
import { filterResearch, RejectedResearch } from "./TypeSafeResearchFilter";

export class ResearchService {
  constructor(
    private readonly materialService: MaterialService,
    private readonly provider: ResearchProviderName = ResearchProviderName.Perplexity
  ) {}

  async research(
    query: string,
    namePrefix?: string,
    options?: ResearchOptions
  ): Promise<PodcastMaterial[]> {
    return (await this.researchWithReport(query, namePrefix, options)).materials;
  }

  /**
   * Like research(), but also reports results the research-filter judgment
   * kept out of the material library, so callers can show why.
   */
  async researchWithReport(
    query: string,
    namePrefix?: string,
    options?: ResearchOptions
  ): Promise<{ materials: PodcastMaterial[]; rejected: RejectedResearch[] }> {
    const provider = ResearchProviderFactory.getProvider(this.provider);
    const researchMaterials = await provider.research(query, options);
    const rejected = await filterResearch({
      query,
      results: researchMaterials,
      loadExistingMaterials: () => this.materialService.getAllMaterials(),
    });
    const rejectedTitles = new Set(rejected.map((r) => r.title));

    const materials: PodcastMaterial[] = [];
    for (const rm of researchMaterials) {
      if (rejectedTitles.has(rm.title)) continue;
      const material = await this.materialService.addMaterial({
        title: namePrefix ? `${namePrefix}: ${rm.title}` : rm.title,
        content: rm.content,
        source: rm.source,
        sourceType: rm.sourceType,
        metadata: rm.metadata,
      });
      materials.push(material);
    }

    return { materials, rejected };
  }
}
