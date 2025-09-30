#!/usr/bin/env node

import { createCLI } from "./cli";
import { validateConfig } from "./utils/config";
import { logger } from "./utils/logger";

async function main() {
  try {
    // Create and run CLI
    const program = createCLI();
    await program.parseAsync(process.argv);
  } catch (error) {
    logger.error("Application error:", error);
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled rejection at:", promise, "reason:", reason);
  process.exit(1);
});

// Run the application
if (require.main === module) {
  main();
}
