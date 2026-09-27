import { IJudgmentProvider } from "../providers/judgment-questions";

// Kept separate from judgment-runtime.ts, which statically imports the real
// TypeSafe provider (and, through it, axios). The global test setup needs to
// install an override before every test; if it did that by importing
// judgment-runtime.ts directly, it would eagerly load axios ahead of any
// individual test's own `vi.mock("axios")`, silently defeating that mock.

let providerOverride: IJudgmentProvider | undefined;

/** Replaces the provider for tests; pass undefined to restore the default. */
export function setJudgmentProvider(provider?: IJudgmentProvider): void {
  providerOverride = provider;
}

/** The test override installed via `setJudgmentProvider`, if any. */
export function getJudgmentProviderOverride(): IJudgmentProvider | undefined {
  return providerOverride;
}
