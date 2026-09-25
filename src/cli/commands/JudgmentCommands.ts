import { Command } from "commander";
import chalk from "chalk";
import {
  JsonlJudgmentLog,
  JudgmentRecord,
  summarizeAgreement,
} from "../../services/JudgmentLog";
import { judgmentLogPath } from "../../services/judgment-runtime";
import { logger } from "../../utils/logger";

export function createJudgmentCommands(): Command {
  const judgmentCommand = new Command("judgment").description(
    "Inspect TypeSafe judgments recorded in shadow or live mode"
  );

  judgmentCommand
    .command("report")
    .description("Summarise agreement between current and TypeSafe judgments")
    .option("-j, --judgment <name>", "Only report this judgment")
    .option(
      "-d, --disagreements <n>",
      "Show up to n recent disagreements per judgment",
      "3"
    )
    .option("--log <path>", "Judgment log to read", judgmentLogPath())
    .action(async (options) => {
      try {
        const records = (await new JsonlJudgmentLog(options.log).readAll()).filter(
          (record) => !options.judgment || record.judgment === options.judgment
        );
        if (records.length === 0) {
          logger.info(`No judgments recorded in ${options.log}`);
          return;
        }

        const disagreementLimit = parseInt(options.disagreements, 10);
        console.log(chalk.cyan(`\nTypeSafe judgment agreement (${options.log})\n`));
        for (const summary of summarizeAgreement(records)) {
          const rate =
            summary.agreementRate === undefined
              ? "n/a"
              : `${(summary.agreementRate * 100).toFixed(1)}%`;
          console.log(
            `${chalk.bold(summary.judgment)}: ${rate} agreement ` +
              `(${summary.agreed}/${summary.compared} compared, ` +
              `${summary.unavailable} unavailable, ${summary.total} total)`
          );

          const disagreements = records
            .filter((r) => r.judgment === summary.judgment && r.agreed === false)
            .slice(-disagreementLimit);
          for (const record of disagreements) {
            printDisagreement(record);
          }
        }
        console.log("");
      } catch (error) {
        logger.error("Failed to report judgments:", error);
      }
    });

  return judgmentCommand;
}

function printDisagreement(record: JudgmentRecord): void {
  console.log(chalk.gray(`  ${record.timestamp}`));
  console.log(`    current:  ${JSON.stringify(record.current)}`);
  console.log(`    typesafe: ${JSON.stringify(record.typesafe)}`);
  if (record.typesafeDetail !== undefined) {
    console.log(`    detail:   ${JSON.stringify(record.typesafeDetail)}`);
  }
  if (record.state !== undefined) {
    const state = JSON.stringify(record.state);
    console.log(
      chalk.gray(`    state:    ${state.length > 200 ? state.slice(0, 200) + "…" : state}`)
    );
  }
}
