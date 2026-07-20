import { Command } from "commander";
import { VoiceService } from "../../services";
import { VoiceRepository } from "../../repositories";
import { VocalProviderFactory, MultispeakerVocalProviderFactory, isMultispeakerCapable } from "../../providers";
import { VocalProviderName, Voice } from "../../types";
import { logger } from "../../utils/logger";

function resolveVoiceLister(provider: VocalProviderName): { getVoices(): Promise<Voice[]> } {
  return isMultispeakerCapable(provider)
    ? MultispeakerVocalProviderFactory.getProvider(provider)
    : VocalProviderFactory.getProvider(provider);
}

export function createVoiceCommands(): Command {
  const voiceCommand = new Command("voice");

  const voiceRepository = new VoiceRepository();
  const voiceService = new VoiceService(voiceRepository);

  voiceCommand.description("Manage voices for text-to-speech").alias("v");

  voiceCommand
    .command("list")
    .description("List all available voices")
    .action(async () => {
      try {
        const voices = await voiceService.getAllVoices();
        if (voices.length === 0) {
          logger.info(
            'No voices found. Use "tweedy voice add" to create voices.'
          );
          return;
        }

        console.log("\nAvailable Voices:");
        voices.forEach((voice) => {
          console.log(
            `  [ID: ${voice.id}] ${voice.name} (${voice.provider}) - ${voice.description}`
          );
        });
      } catch (error) {
        logger.error("Failed to list voices:", error);
      }
    });

  voiceCommand
    .command("add")
    .description("Add a new voice")
    .option("-n, --name <name>", "Voice name")
    .option("-d, --description <description>", "Voice description")
    .option(
      "-p, --provider <provider>",
      "Voice provider (elevenlabs, elevenlabs_v3, openai, hume, cartesia, voicegen)",
      "elevenlabs"
    )
    .option("--provider-id <id>", "Provider-specific voice ID")
    .option(
      "--accent <accent>",
      "Accent to pin via audio tags (ElevenLabs v3 only, e.g. \"American\")"
    )
    .option(
      "--language-code <code>",
      "Locale/accent code for the voice, e.g. \"en-AU\" (Google Chirp/Gemini providers)"
    )
    .action(async (options) => {
      try {
        if (!options.name || !options.providerId) {
          logger.error("Name and provider-id are required");
          return;
        }

        const providerOptions: Record<string, unknown> = {};
        if (options.accent) providerOptions.accent = options.accent;
        if (options.languageCode) providerOptions.languageCode = options.languageCode;

        const voice = await voiceService.createVoice({
          name: options.name,
          description: options.description || options.name,
          provider: options.provider as VocalProviderName,
          providerId: options.providerId,
          settings: Object.keys(providerOptions).length > 0 ? { providerOptions } : {},
        });

        logger.success(`Voice created: ${voice.name}`);
      } catch (error) {
        logger.error("Failed to create voice:", error);
      }
    });

  voiceCommand
    .command("import")
    .description("Import voices from a provider")
    .option(
      "-p, --provider <provider>",
      "Provider to import from (elevenlabs, openai, hume, cartesia, google_gemini_multispeaker, voicegen)",
      "elevenlabs"
    )
    .action(async (options) => {
      try {
        const provider = resolveVoiceLister(
          options.provider as VocalProviderName
        );
        const voices = await provider.getVoices();

        let importedCount = 0;
        for (const voice of voices) {
          try {
            await voiceService.createVoice({
              name: voice.name,
              description: voice.description,
              provider: voice.provider,
              providerId: voice.providerId,
              settings: voice.settings,
            });
            importedCount++;
          } catch (error) {
            logger.warn(`Failed to import voice ${voice.name}:`, error);
          }
        }

        logger.success(
          `Imported ${importedCount} voices from ${options.provider}`
        );
      } catch (error) {
        logger.error("Failed to import voices:", error);
      }
    });

  voiceCommand
    .command("delete <id>")
    .description("Delete a voice")
    .action(async (id) => {
      try {
        await voiceService.deleteVoice(id);
        logger.success(`Voice deleted: ${id}`);
      } catch (error) {
        logger.error("Failed to delete voice:", error);
      }
    });

  return voiceCommand;
}
