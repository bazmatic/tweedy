import { beforeEach } from "vitest";
// Imported from the leaf state module, not judgment-runtime.ts: that module
// statically imports the real TypeSafe provider (and, through it, axios),
// which would defeat a test file's own `vi.mock("axios")` if loaded first by
// this global setup. See judgment-provider-state.ts.
import { setJudgmentProvider } from "../services/judgment-provider-state";
import { unavailableProvider } from "./judgments";

// No test reaches the live judgment API unless it scripts a provider or is a
// *.smoke.test.ts that constructs one directly.
beforeEach(() => {
  setJudgmentProvider(unavailableProvider());
});
