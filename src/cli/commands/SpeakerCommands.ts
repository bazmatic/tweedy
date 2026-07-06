import { Command } from "commander";
import { SpeakerService } from "../../services";
import { SpeakerRepository, VoiceRepository } from "../../repositories";
import { logger } from "../../utils/logger";

export function createSpeakerCommands(): Command {
  const speakerCommand = new Command("speaker");

  const speakerRepository = new SpeakerRepository();
  const voiceRepository = new VoiceRepository();
  const speakerService = new SpeakerService(speakerRepository, voiceRepository);

  speakerCommand
    .description("Manage speakers for podcast generation")
    .alias("s");

  speakerCommand
    .command("list")
    .description("List all speakers")
    .action(async () => {
      try {
        const speakers = await speakerService.getAllSpeakers();
        if (speakers.length === 0) {
          logger.info(
            'No speakers found. Use "tweedy speaker add" to create speakers.'
          );
          return;
        }

        console.log("\nAvailable Speakers:");
        speakers.forEach((speaker) => {
          console.log(
            `  [ID: ${speaker.id}] ${speaker.name} (${speaker.voice.name}) - ${speaker.personality}`
          );
          console.log(`    Expert: ${speaker.isExpert ? "Yes" : "No"}`);
          console.log(`    Voice Style: ${speaker.voiceStyle}`);
          console.log("");
        });
      } catch (error) {
        logger.error("Failed to list speakers:", error);
      }
    });

  speakerCommand
    .command("add")
    .description("Add a new speaker")
    .option("-n, --name <name>", "Speaker name")
    .option("-p, --personality <personality>", "Speaker personality")
    .option("-v, --voice-id <voiceId>", "Voice ID to use")
    .option("-s, --voice-style <style>", "Voice style/instructions")
    .option("-e, --expert", "Mark as expert speaker")
    .action(async (options) => {
      try {
        if (!options.name || !options.personality || !options.voiceId) {
          logger.error("Name, personality, and voice-id are required");
          return;
        }

        const speaker = await speakerService.createSpeaker({
          name: options.name,
          personality: options.personality,
          voiceId: options.voiceId,
          voiceStyle: options.voiceStyle || "Natural conversational tone",
          isExpert: options.expert || false,
        });

        logger.success(`Speaker created: ${speaker.name}`);
      } catch (error) {
        logger.error("Failed to create speaker:", error);
      }
    });

  speakerCommand
    .command("update <id>")
    .description("Update a speaker")
    .option("-n, --name <name>", "New speaker name")
    .option("-p, --personality <personality>", "New personality")
    .option("-v, --voice-id <voiceId>", "New voice ID")
    .option("-s, --voice-style <style>", "New voice style")
    .option("-e, --expert", "Mark as expert")
    .option("--no-expert", "Remove expert status")
    .action(async (id, options) => {
      try {
        const updateData: any = {};
        if (options.name) updateData.name = options.name;
        if (options.personality) updateData.personality = options.personality;
        if (options.voiceId) updateData.voiceId = options.voiceId;
        if (options.voiceStyle) updateData.voiceStyle = options.voiceStyle;
        if (options.expert !== undefined) updateData.isExpert = options.expert;

        await speakerService.updateSpeaker(id, updateData);
        logger.success(`Speaker updated: ${id}`);
      } catch (error) {
        logger.error("Failed to update speaker:", error);
      }
    });

  speakerCommand
    .command("delete <id>")
    .description("Delete a speaker")
    .action(async (id) => {
      try {
        await speakerService.deleteSpeaker(id);
        logger.success(`Speaker deleted: ${id}`);
      } catch (error) {
        logger.error("Failed to delete speaker:", error);
      }
    });

  return speakerCommand;
}
