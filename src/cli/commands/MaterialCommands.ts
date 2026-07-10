import { Command } from "commander";
import inquirer from "inquirer";
import { MaterialService } from "../../services";
import { MaterialRepository } from "../../repositories";
import { RAGService } from "../../rag";
import { SourceType } from "../../types";
import { logger } from "../../utils/logger";

export function createMaterialCommands(): Command {
  const materialCommand = new Command("material");

  const materialRepository = new MaterialRepository();
  const ragService = new RAGService();
  const materialService = new MaterialService(materialRepository, ragService);

  materialCommand
    .description("Manage podcast materials and content")
    .alias("m");

  materialCommand
    .command("list")
    .description("List all materials")
    .option("-s, --source <source>", "Filter by source")
    .option("-t, --type <type>", "Filter by source type")
    .action(async (options) => {
      try {
        let materials = await materialService.getAllMaterials();

        if (options.source) {
          materials = materials.filter((m) =>
            m.source.includes(options.source)
          );
        }

        if (options.type) {
          materials = materials.filter((m) => m.sourceType === options.type);
        }

        if (materials.length === 0) {
          logger.info(
            'No materials found. Use "tweedy material add" to add materials.'
          );
          return;
        }

        console.log("\nAvailable Materials:");
        materials.forEach((material) => {
          console.log(
            `  [ID: ${material.id}] ${material.title} (${material.sourceType})`
          );
          console.log(`    Source: ${material.source}`);
          console.log(`    Content: ${material.content.substring(0, 100)}...`);
          console.log("");
        });
      } catch (error) {
        logger.error("Failed to list materials:", error);
      }
    });

  materialCommand
    .command("add")
    .description("Add material from various sources")
    .option("-f, --file <path>", "Add from file")
    .option("-u, --url <url>", "Add from URL")
    .option("-t, --text <text>", "Add text content")
    .option("-n, --name <name>", "Material name")
    .action(async (options) => {
      try {
        if (!options.name) {
          logger.error("Name is required");
          return;
        }

        let content = "";
        let source = "";
        let sourceType = SourceType.Manual;

        if (options.file) {
          const { DocumentService } = await import("../../services");
          const documentService = new DocumentService(materialService);
          await documentService.processDocument(options.file, options.name);
          logger.success(`Material added from file: ${options.file}`);
          return;
        }

        if (options.url) {
          const { DocumentService } = await import("../../services");
          const documentService = new DocumentService(materialService);
          await documentService.processWebPage(options.url, options.name);
          logger.success(`Material added from URL: ${options.url}`);
          return;
        }

        if (options.text) {
          content = options.text;
          source = "Manual input";
          sourceType = SourceType.Manual;
        } else {
          logger.error("One of --file, --url, or --text is required");
          return;
        }

        await materialService.addMaterial({
          title: options.name,
          content,
          source,
          sourceType,
          metadata: {},
        });

        logger.success(`Material added: ${options.name}`);
      } catch (error) {
        logger.error("Failed to add material:", error);
      }
    });

  materialCommand
    .command("search <query>")
    .description("Search materials using semantic search")
    .option("-l, --limit <number>", "Limit results", "10")
    .action(async (query, options) => {
      try {
        const materials = await materialService.searchMaterials(query);
        const limit = parseInt(options.limit);
        const limitedMaterials = materials.slice(0, limit);

        if (limitedMaterials.length === 0) {
          logger.info("No materials found matching your query.");
          return;
        }

        console.log(`\nSearch Results for "${query}":`);
        limitedMaterials.forEach((material, index) => {
          console.log(`  ${index + 1}. ${material.title}`);
          console.log(`     Source: ${material.source}`);
          console.log(`     Content: ${material.content.substring(0, 150)}...`);
          console.log("");
        });
      } catch (error) {
        logger.error("Failed to search materials:", error);
      }
    });

  materialCommand
    .command("delete <id>")
    .description("Delete a material")
    .action(async (id) => {
      try {
        await materialService.deleteMaterial(id);
        logger.success(`Material deleted: ${id}`);
      } catch (error) {
        logger.error("Failed to delete material:", error);
      }
    });

  materialCommand
    .command("clear")
    .description("Delete all materials")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (options) => {
      try {
        const materials = await materialService.getAllMaterials();

        if (materials.length === 0) {
          logger.info("No materials to clear.");
          return;
        }

        if (!options.yes) {
          const { confirmed } = await inquirer.prompt([
            {
              type: "confirm",
              name: "confirmed",
              message: `Delete ${materials.length} materials? This cannot be undone.`,
              default: false,
            },
          ]);

          if (!confirmed) {
            logger.info("Cancelled.");
            return;
          }
        }

        const count = await materialService.clearAllMaterials();
        logger.success(`Cleared ${count} materials.`);
      } catch (error) {
        logger.error("Failed to clear materials:", error);
      }
    });

  return materialCommand;
}
