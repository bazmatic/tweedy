import { MaterialService } from "./MaterialService";
import { ResearchProviderFactory } from "../providers";
import { PodcastMaterial, ResearchOptions, ResearchProviderName } from "../types";

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
    const provider = ResearchProviderFactory.getProvider(this.provider);
    const researchMaterials = await provider.research(query, options);

    const materials: PodcastMaterial[] = [];
    for (const rm of researchMaterials) {
      const material = await this.materialService.addMaterial({
        title: namePrefix ? `${namePrefix}: ${rm.title}` : rm.title,
        content: rm.content,
        source: rm.source,
        sourceType: rm.sourceType,
        metadata: rm.metadata,
      });
      materials.push(material);
    }

    return materials;
  }
}
