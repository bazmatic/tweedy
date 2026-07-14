import { Command } from "commander";
import { readFile, writeFile } from "fs/promises";
import inquirer from "inquirer";
import { hasScriptEditChanges, ScriptService } from "../../services";
import {
  ScriptRepository,
  SpeakerRepository,
  MaterialRepository,
  VoiceRepository,
  SpeechRepository,
} from "../../repositories";
import { RAGService } from "../../rag";
import {
  AudienceProfile,
  ScriptEditSummary,
  SpeakerAllocation,
} from "../../types";
import { logger } from "../../utils/logger";

function parseAudienceProfile(value: string): AudienceProfile {
  const profile = Object.values(AudienceProfile).find(
    (candidate) => candidate === value
  );
  if (!profile) {
    throw new Error(`Unknown audience profile: ${value}`);
  }
  return profile;
}

function describeEditSummary(summary: ScriptEditSummary): string {
  return [
    `${summary.added} added`,
    `${summary.removed} removed`,
    `${summary.edited} edited`,
    `${summary.unchanged} unchanged`,
    `reordered: ${summary.reordered ? "yes" : "no"}`,
  ].join(", ");
}

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
          console.log(`    Audience: ${script.audienceProfile}`);
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
      "--audience <profile>",
      `Audience profile (${Object.values(AudienceProfile).join(", ")})`,
      AudienceProfile.General
    )
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
          audienceProfile: parseAudienceProfile(options.audience),
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
        console.log(`  Audience: ${script.audienceProfile}`);
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
        console.log(`Audience: ${script.audienceProfile}`);
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
    .option(
      "--editable",
      "Export an id-tagged document that can be changed and imported"
    )
    .action(async (id, options) => {
      try {
        const document = options.editable
          ? await scriptService.exportScriptEditable(id)
          : await scriptService.exportScriptAsText(id);

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
    .command("import <id> <file>")
    .description("Preview and apply edits from an editable script export")
    .option("-y, --yes", "Apply changes without confirmation")
    .option("--dry-run", "Validate and preview changes without writing them")
    .action(async (id, file, options) => {
      try {
        const text = await readFile(file, "utf-8");
        const plan = await scriptService.planEditedScriptImport(id, text);
        const summaryText = describeEditSummary(plan.summary);
        logger.info(`Script edit preview: ${summaryText}`);

        if (!hasScriptEditChanges(plan.summary)) {
          logger.info("No script changes to apply.");
          return;
        }
        if (options.dryRun) {
          logger.info("Dry run complete; no files were changed.");
          return;
        }

        if (!options.yes) {
          const { confirmed } = await inquirer.prompt([
            {
              type: "confirm",
              name: "confirmed",
              message: `Apply script edits (${summaryText})?`,
              default: false,
            },
          ]);
          if (!confirmed) {
            logger.info("Cancelled.");
            return;
          }
        }

        const result = await scriptService.applyEditedScriptImport(plan);
        logger.success(`Script edits applied: ${describeEditSummary(result)}`);
        logger.warn(
          `Any audio previously generated from this script is now stale. Run "tweedy audio generate ${id}" to regenerate it.`
        );
      } catch (error) {
        logger.error("Failed to import script edits:", error);
        process.exitCode = 1;
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
