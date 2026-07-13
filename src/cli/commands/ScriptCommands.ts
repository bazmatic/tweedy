import { Command } from "commander";
import { writeFile } from "fs/promises";
import { ScriptService } from "../../services";
import {
  ScriptRepository,
  SpeakerRepository,
  MaterialRepository,
  VoiceRepository,
  SpeechRepository,
} from "../../repositories";
import { RAGService } from "../../rag";
import { SpeakerAllocation } from "../../types";
import { logger } from "../../utils/logger";

export function createScriptCommands(): Command {
  const scriptCommand = new Command("script");

  const scriptRepository = new ScriptRepository();
  const speakerRepository = new SpeakerRepository();
  const materialRepository = new MaterialRepository();
  const voiceRepository = new VoiceRepository();
  const speechRepository = new SpeechRepository();
  const ragService = new RAGService();
  const scriptService = new ScriptService(
    scriptRepository,
    speakerRepository,
    materialRepository,
    voiceRepository,
    speechRepository,
    ragService
  );

  scriptCommand.description("Generate and manage podcast scripts").alias("s");

  scriptCommand
    .command("list")
    .description("List all scripts")
    .action(async () => {
      try {
        const scripts = await scriptService.getAllScripts();
        if (scripts.length === 0) {
          logger.info(
            'No scripts found. Use "tweedy script generate" to create scripts.'
          );
          return;
        }

        console.log("\nAvailable Scripts:");
        scripts.forEach((script) => {
          console.log(`  ${script.title}`);
          console.log(`    Description: ${script.description}`);
          console.log(
            `    Speakers: ${script.speakers.map((s) => s.name).join(", ")}`
          );
          console.log(`    Speeches: ${script.speeches.length}`);
          console.log(`    Materials: ${script.materials.length}`);
          console.log(`    Created: ${script.createdAt.toLocaleDateString()}`);
          console.log("");
        });
      } catch (error) {
        logger.error("Failed to list scripts:", error);
      }
    });

  scriptCommand
    .command("generate")
    .description("Generate a new podcast script")
    .option("-t, --title <title>", "Script title")
    .option("-d, --description <description>", "Script description")
    .option(
      "-s, --speakers <speakers>",
      "Comma-separated speaker slugs or IDs"
    )
    .option("-m, --materials <materials>", "Comma-separated material IDs")
    .option(
      "--max-turns <turns>",
      "Maximum number of turns (safety ceiling only; pacing is driven by --max-duration)",
      "60"
    )
    .option("--max-duration <duration>", "Maximum duration in seconds", "600")
    .option(
      "--allocation <allocation>",
      "Speaker allocation strategy",
      "sequential"
    )
    .action(async (options) => {
      try {
        if (!options.title || !options.speakers) {
          logger.error("Title and speakers are required");
          return;
        }

        const speakerIds = options.speakers
          .split(",")
          .map((id: string) => ({ id: id.trim() }));
        const materialIds = options.materials
          ? options.materials
              .split(",")
              .map((id: string) => ({ id: id.trim() }))
          : [];

        const params = {
          title: options.title,
          description: options.description || "",
          speakers: speakerIds,
          materials: materialIds,
          maxTurns: parseInt(options.maxTurns),
          maxDuration: parseInt(options.maxDuration),
          allocation: options.allocation as SpeakerAllocation,
        };

        logger.progress("Generating script...");
        const script = await scriptService.generateScript(params);

        logger.success(`Script generated: ${script.title}`);
        console.log(`\nScript Details:`);
        console.log(`  ID: ${script.id}`);
        console.log(`  Title: ${script.title}`);
        console.log(
          `  Speakers: ${script.speakers.map((s) => s.name).join(", ")}`
        );
        console.log(`  Speeches: ${script.speeches.length}`);
        console.log(`  Materials: ${script.materials.length}`);
      } catch (error) {
        logger.error("Failed to generate script:", error);
      }
    });

  scriptCommand
    .command("show <id>")
    .description("Show script details and content")
    .action(async (id) => {
      try {
        const script = await scriptService.getScript(id);

        console.log(`\nScript: ${script.title}`);
        console.log(`Description: ${script.description}`);
        console.log(
          `Speakers: ${script.speakers.map((s) => s.name).join(", ")}`
        );
        console.log(`Created: ${script.createdAt.toLocaleDateString()}`);
        console.log(`\nSpeeches (${script.speeches.length}):`);

        script.speeches.forEach((speech, index) => {
          console.log(`\n  ${index + 1}. ${speech.speaker.name}:`);
          console.log(`     ${speech.message}`);
        });

        console.log(`\nMaterials (${script.materials.length}):`);
        script.materials.forEach((material, index) => {
          console.log(`\n  ${index + 1}. ${material.title}`);
          console.log(`     Source: ${material.source}`);
          console.log(`     Content: ${material.content.substring(0, 200)}...`);
        });
      } catch (error) {
        logger.error("Failed to show script:", error);
      }
    });

  scriptCommand
    .command("export <id>")
    .description("Export a script as a single human-readable document")
    .option("-o, --output <file>", "Write the document to a file instead of stdout")
    .action(async (id, options) => {
      try {
        const document = await scriptService.exportScriptAsText(id);

        if (options.output) {
          await writeFile(options.output, document, "utf-8");
          logger.success(`Script exported to ${options.output}`);
        } else {
          console.log(document);
        }
      } catch (error) {
        logger.error("Failed to export script:", error);
      }
    });

  scriptCommand
    .command("delete <id>")
    .description("Delete a script")
    .action(async (id) => {
      try {
        await scriptService.deleteScript(id);
        logger.success(`Script deleted: ${id}`);
      } catch (error) {
        logger.error("Failed to delete script:", error);
      }
    });

  return scriptCommand;
}
