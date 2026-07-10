import { Command } from "commander";
import { MaterialService, ResearchService } from "../../services";
import { MaterialRepository } from "../../repositories";
import { RAGService } from "../../rag";
import { ResearchProviderName } from "../../types";
import { logger } from "../../utils/logger";

export function createResearchCommands(): Command {
  const researchCommand = new Command("research");

  const materialRepository = new MaterialRepository();
  const ragService = new RAGService();
  const materialService = new MaterialService(materialRepository, ragService);

  researchCommand
    .description("Research a topic via an external provider and save results as materials")
    .argument("<query>", "The research request")
    .option("-n, --name <name>", "Title prefix for created materials")
    .option(
      "-p, --provider <provider>",
      "Research provider to use",
      ResearchProviderName.Perplexity
    )
    .action(async (query, options) => {
      try {
        const provider = options.provider as ResearchProviderName;
        const researchService = new ResearchService(materialService, provider);

        const materials = await researchService.research(query, options.name);

        logger.success(`Added ${materials.length} material(s) from research:`);
        materials.forEach((material) => {
          console.log(`  [ID: ${material.id}] ${material.title} (${material.source})`);
        });
      } catch (error) {
        logger.error("Failed to research topic:", error);
      }
    });

  return researchCommand;
}
