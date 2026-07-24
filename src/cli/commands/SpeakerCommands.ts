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
            `  [${speaker.slug}] ${speaker.name} (${speaker.voice.name}) - ${speaker.personality}`
          );
          console.log(`    ID: ${speaker.id}`);
          console.log(`    Voice Style: ${speaker.voiceStyle}`);
          if (speaker.physicalAppearance) {
            console.log(`    Appearance: ${speaker.physicalAppearance}`);
          }
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
    .option(
      "-m, --mannerisms <mannerisms>",
      "Example filler phrases/verbal tics (e.g. 'Oh, wow; Huh, interesting')"
    )
    .option(
      "-a, --appearance <description>",
      "Physical appearance description, for consistent image generation downstream (e.g. 'Woman in her 40s, curly red hair, glasses, olive cardigan')"
    )
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
          mannerisms: options.mannerisms,
          physicalAppearance: options.appearance,
        });

        logger.success(`Speaker created: ${speaker.slug}`);
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
    .option(
      "-m, --mannerisms <mannerisms>",
      "New example filler phrases/verbal tics"
    )
    .option(
      "-a, --appearance <description>",
      "New physical appearance description"
    )
    .option("--slug <slug>", "New speaker slug (must be unique)")
    .action(async (id, options) => {
      try {
        const updateData: any = {};
        if (options.name) updateData.name = options.name;
        if (options.personality) updateData.personality = options.personality;
        if (options.voiceId) updateData.voiceId = options.voiceId;
        if (options.voiceStyle) updateData.voiceStyle = options.voiceStyle;
        if (options.mannerisms) updateData.mannerisms = options.mannerisms;
        if (options.appearance) updateData.physicalAppearance = options.appearance;
        if (options.slug) updateData.slug = options.slug;

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
