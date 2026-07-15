import { Command } from "commander";
import { SpeakerService } from "../../services";
import { SpeakerRepository, VoiceRepository } from "../../repositories";
import { logger } from "../../utils/logger";
import { EpistemicRole } from "../../types";
import { SpeakerRoleProfileFactory } from "../../agents/SpeakerRoleProfileFactory";

function parseEpistemicRole(value: string): EpistemicRole {
  const role = Object.values(EpistemicRole).find(
    (candidate) => candidate === value
  );
  if (!role) {
    throw new Error(`Unknown epistemic role: ${value}`);
  }
  return role;
}

export function createSpeakerCommands(): Command {
  const speakerCommand = new Command("speaker");

  const speakerRepository = new SpeakerRepository();
  const voiceRepository = new VoiceRepository();
  const speakerService = new SpeakerService(speakerRepository, voiceRepository);
  const roleProfileFactory = new SpeakerRoleProfileFactory();

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
          console.log(`    Expert: ${speaker.isExpert ? "Yes" : "No"}`);
          console.log(`    Epistemic role: ${speaker.roleProfile?.epistemicRole}`);
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
      "-a, --appearance <description>",
      "Physical appearance description, for consistent image generation downstream (e.g. 'Woman in her 40s, curly red hair, glasses, olive cardigan')"
    )
    .option("-e, --expert", "Mark as expert speaker")
    .option(
      "-r, --role <role>",
      `Epistemic role (${Object.values(EpistemicRole).join(", ")})`
    )
    .action(async (options) => {
      try {
        if (!options.name || !options.personality || !options.voiceId) {
          logger.error("Name, personality, and voice-id are required");
          return;
        }

        const epistemicRole = options.role
          ? parseEpistemicRole(options.role)
          : options.expert
            ? EpistemicRole.Expert
            : EpistemicRole.AudienceGuide;
        const speaker = await speakerService.createSpeaker({
          name: options.name,
          personality: options.personality,
          voiceId: options.voiceId,
          voiceStyle: options.voiceStyle || "Natural conversational tone",
          physicalAppearance: options.appearance,
          isExpert: epistemicRole === EpistemicRole.Expert,
          roleProfile: roleProfileFactory.create(epistemicRole),
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
      "-a, --appearance <description>",
      "New physical appearance description"
    )
    .option("-e, --expert", "Mark as expert")
    .option("--no-expert", "Remove expert status")
    .option(
      "-r, --role <role>",
      `New epistemic role (${Object.values(EpistemicRole).join(", ")})`
    )
    .option("--slug <slug>", "New speaker slug (must be unique)")
    .action(async (id, options) => {
      try {
        const updateData: any = {};
        if (options.name) updateData.name = options.name;
        if (options.personality) updateData.personality = options.personality;
        if (options.voiceId) updateData.voiceId = options.voiceId;
        if (options.voiceStyle) updateData.voiceStyle = options.voiceStyle;
        if (options.appearance) updateData.physicalAppearance = options.appearance;
        if (options.role) {
          const epistemicRole = parseEpistemicRole(options.role);
          updateData.roleProfile = roleProfileFactory.create(epistemicRole);
          updateData.isExpert = epistemicRole === EpistemicRole.Expert;
        } else if (options.expert !== undefined) {
          const epistemicRole = options.expert
            ? EpistemicRole.Expert
            : EpistemicRole.AudienceGuide;
          updateData.roleProfile = roleProfileFactory.create(epistemicRole);
          updateData.isExpert = options.expert;
        }
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
