import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["**/node_modules/**", "**/dist/**"],
    // Keep TypeSafe judgments off in tests even if a local .env enables them,
    // so no test silently calls the live API. (dotenv never overrides a set var.)
    env: { TYPESAFE_JUDGMENTS: "" },
  },
});
