import { Command } from "commander";
import { createVoiceCommands } from "./commands/VoiceCommands";
import { createSpeakerCommands } from "./commands/SpeakerCommands";
import { createMaterialCommands } from "./commands/MaterialCommands";
import { createScriptCommands } from "./commands/ScriptCommands";
import { createAudioCommands } from "./commands/AudioCommands";
import { appConfig, validateConfig } from "../utils/config";
import { logger } from "../utils/logger";
import chalk from "chalk";

export function createCLI(): Command {
  const program = new Command();

  program
    .name("tweedy")
    .description("AI-powered podcast generation CLI tool")
    .version("1.0.0");

  // Global options
  program
    .option("-v, --verbose", "Enable verbose logging")
    .option("--debug", "Enable debug logging")
    .hook("preAction", (thisCommand) => {
      const options = thisCommand.opts();

      if (options.debug) {
        logger.setLevel(1); // DEBUG level
      } else if (options.verbose) {
        logger.setLevel(2); // INFO level
      }
    });

  // Add subcommands
  program.addCommand(createVoiceCommands());
  program.addCommand(createSpeakerCommands());
  program.addCommand(createMaterialCommands());
  program.addCommand(createScriptCommands());
  program.addCommand(createAudioCommands());

  // Quick start command
  program
    .command("quickstart")
    .description("Quick start guide for new users")
    .action(() => {
      console.log(chalk.cyan("\n🚀 Tweedy Quick Start Guide\n"));
      console.log("1. Set up your API keys:");
      console.log("   - Copy env.example to .env");
      console.log("   - Add your API keys (OpenAI, Anthropic, ElevenLabs)");
      console.log("");
      console.log("2. Import voices:");
      console.log("   tweedy voice import --provider elevenlabs");
      console.log("");
      console.log("3. Create a speaker:");
      console.log(
        '   tweedy speaker add --name "Alex" --personality "Friendly and curious" --voice-id <voice-id>'
      );
      console.log("");
      console.log("4. Add materials:");
      console.log(
        '   tweedy material add --file document.pdf --name "Research Paper"'
      );
      console.log("");
      console.log("5. Generate a script:");
      console.log(
        '   tweedy script generate --title "Tech Discussion" --speakers <speaker-id> --materials <material-id>'
      );
      console.log("");
      console.log("6. Generate audio:");
      console.log("   tweedy audio generate <script-id>");
      console.log("");
      console.log(chalk.green("Happy podcasting! 🎙️\n"));
    });

  // Status command
  program
    .command("status")
    .description("Show system status and configuration")
    .action(() => {
      console.log(chalk.cyan("\n📊 Tweedy Status\n"));
      console.log("Configuration:");
      console.log(`  Data Directory: ${appConfig.dataDir}`);
      console.log(`  Audio Directory: ${appConfig.audioDir}`);
      console.log(`  Scripts Directory: ${appConfig.scriptsDir}`);
      console.log(`  Embeddings Directory: ${appConfig.embeddingsDir}`);
      console.log(
        `  Default Voice Provider: ${appConfig.defaultVoiceProvider}`
      );
      console.log("");

      // Check environment variables
      const requiredVars = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"];
      const missingVars = requiredVars.filter(
        (varName) => !process.env[varName]
      );

      if (missingVars.length > 0) {
        console.log(chalk.red("❌ Missing environment variables:"));
        missingVars.forEach((varName) => console.log(`  - ${varName}`));
        console.log("");
      } else {
        console.log(
          chalk.green("✅ All required environment variables are set")
        );
      }

      const optionalVars = ["ELEVENLABS_API_KEY"];
      const availableOptional = optionalVars.filter(
        (varName) => process.env[varName]
      );

      if (availableOptional.length > 0) {
        console.log(chalk.green("✅ Optional providers available:"));
        availableOptional.forEach((varName) => console.log(`  - ${varName}`));
      }
    });

  return program;
}

