import * as path from "path";
import { Command } from "commander";
import { AudioService } from "../../services";
import { ScriptService } from "../../services";
import {
  ScriptRepository,
  SpeakerRepository,
  MaterialRepository,
  VoiceRepository,
  SpeechRepository,
} from "../../repositories";
import { RAGService } from "../../rag";
import { VocalProviderName } from "../../types";
import { logger } from "../../utils/logger";
import { appConfig } from "../../utils/config";

export function createAudioCommands(): Command {
  const audioCommand = new Command("audio");

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
  const audioService = new AudioService();

  audioCommand.description("Generate audio from scripts").alias("a");

  audioCommand
    .command("generate <scriptId>")
    .description("Generate audio from a script")
    .option("-o, --output <path>", "Output file path")
    .option(
      "-p, --provider <provider>",
      "Voice provider (elevenlabs, openai)",
      "elevenlabs"
    )
    .action(async (scriptId, options) => {
      try {
        logger.progress(`Generating audio for script ${scriptId}...`);

        const script = await scriptService.getScript(scriptId);
        const outputPath =
          options.output ||
          path.join(appConfig.audioDir, `podcast-${scriptId}.mp3`);

        await audioService.generateAudio(script.speeches, outputPath, scriptId);

        logger.success(`Audio generated: ${outputPath}`);
      } catch (error) {
        logger.error("Failed to generate audio:", error);
      }
    });

  audioCommand
    .command("process <input> <output>")
    .description("Process an audio file (normalize, remove silence)")
    .action(async (input, output) => {
      try {
        logger.progress(`Processing audio: ${input} -> ${output}`);

        await audioService.processAudioFile(input, output);

        logger.success(`Audio processed: ${output}`);
      } catch (error) {
        logger.error("Failed to process audio:", error);
      }
    });

  return audioCommand;
}
