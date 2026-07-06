import { IMaterialService, PodcastMaterial, MaterialRecord } from "../types";
import { MaterialRepository } from "../repositories";
import { RAGService } from "../rag";
import { logger } from "../utils/logger";

export class MaterialService implements IMaterialService {
  constructor(
    private readonly materialRepository: MaterialRepository,
    private readonly ragService: RAGService
  ) {}

  async addMaterial(
    material: Omit<MaterialRecord, "id" | "createdAt">
  ): Promise<PodcastMaterial> {
    try {
      const record = await this.materialRepository.create(material);
      const podcastMaterial = this.mapRecordToMaterial(record);

      // Add to RAG system for semantic search
      await this.ragService.addMaterials([podcastMaterial]);

      logger.info(`Material added: ${record.title}`);
      return podcastMaterial;
    } catch (error) {
      logger.error("Failed to add material:", error);
      throw error;
    }
  }

  async getMaterial(id: string): Promise<PodcastMaterial> {
    const record = await this.materialRepository.getById(id);
    if (!record) {
      throw new Error(`Material with id ${id} not found`);
    }
    return this.mapRecordToMaterial(record);
  }

  async getAllMaterials(): Promise<PodcastMaterial[]> {
    const records = await this.materialRepository.getAll();
    return records.map((record) => this.mapRecordToMaterial(record));
  }

  async deleteMaterial(id: string): Promise<void> {
    const deleted = await this.materialRepository.delete(id);
    if (!deleted) {
      throw new Error(`Material with id ${id} not found`);
    }
  }

  async searchMaterials(query: string): Promise<PodcastMaterial[]> {
    try {
      const relevantDocs = await this.ragService.searchRelevantContent(
        query,
        10
      );

      // Convert documents back to materials
      const materials: PodcastMaterial[] = [];
      for (const doc of relevantDocs) {
        const record = await this.materialRepository.getById(doc.id);
        if (record) {
          materials.push(this.mapRecordToMaterial(record));
        }
      }

      return materials;
    } catch (error) {
      logger.error("Failed to search materials:", error);
      throw error;
    }
  }

  private mapRecordToMaterial(record: MaterialRecord): PodcastMaterial {
    return {
      id: record.id,
      title: record.title,
      content: record.content,
      source: record.source,
      sourceType: record.sourceType,
      metadata: record.metadata,
      createdAt: record.createdAt,
    };
  }
}

