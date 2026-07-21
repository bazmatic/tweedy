import * as path from "path";
import { Command } from "commander";
import { AudioService, timelinePathFor } from "../../services";
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
import { TimelineRefinementService } from "../../services/TimelineRefinementService";
import * as fs from "fs-extra";

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
    .option(
      "--refine-timeline",
      "Refine timeline.json entry boundaries and word timestamps using the OpenAI Whisper API after generation"
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

        if (options.refineTimeline) {
          await refineTimelineForOutput(outputPath);
        }
      } catch (error) {
        logger.error("Failed to generate audio:", error);
      }
    });

  audioCommand
    .command("regenerate-speech <scriptId> <speechId>")
    .description(
      "Re-synthesize a single speech (e.g. after fixing a typo/mispronunciation) and re-splice it into the existing audio track"
    )
    .option("-o, --output <path>", "Output file path")
    .action(async (scriptId, speechId, options) => {
      try {
        logger.progress(`Regenerating speech ${speechId} for script ${scriptId}...`);

        const script = await scriptService.getScript(scriptId);
        const outputPath =
          options.output ||
          path.join(appConfig.audioDir, `podcast-${scriptId}.mp3`);

        await audioService.regenerateSpeech(
          script.speeches,
          speechId,
          outputPath,
          scriptId
        );

        logger.success(`Audio regenerated: ${outputPath}`);
      } catch (error) {
        logger.error("Failed to regenerate speech:", error);
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

  audioCommand
    .command("refine-timeline <scriptId>")
    .description(
      "Refine an existing episode's timeline.json entry boundaries and word timestamps using the OpenAI Whisper API"
    )
    .option("-o, --output <path>", "Audio file path (defaults to the standard generated path for this script)")
    .action(async (scriptId, options) => {
      try {
        const outputPath =
          options.output ||
          path.join(appConfig.audioDir, `podcast-${scriptId}.mp3`);

        await refineTimelineForOutput(outputPath);
      } catch (error) {
        logger.error("Failed to refine timeline:", error);
      }
    });

  async function refineTimelineForOutput(outputPath: string): Promise<void> {
    const timelinePath = timelinePathFor(outputPath);

    if (!(await fs.pathExists(timelinePath))) {
      logger.error(`No timeline found at ${timelinePath} — generate audio first.`);
      return;
    }

    logger.progress(`Refining timeline via Whisper: ${timelinePath}...`);
    const timeline = await fs.readJson(timelinePath);
    const refined = await TimelineRefinementService.refineTimeline(outputPath, timeline);
    await fs.writeJson(timelinePath, refined, { spaces: 2 });
    logger.success(`Timeline refined: ${timelinePath}`);
  }

  return audioCommand;
}
