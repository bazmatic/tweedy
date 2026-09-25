// Per-judgment rollout modes for TypeSafe-backed decisions.
//   off    - current behaviour only; TypeSafe is never called.
//   shadow - run current and TypeSafe, act on current, log both for comparison.
//   on     - act on TypeSafe; fall back to current if TypeSafe is unavailable.
export type JudgmentMode = "off" | "shadow" | "on";

export type JudgmentModes = Readonly<Record<string, JudgmentMode>>;

const WILDCARD = "*";
const VALID_MODES: readonly JudgmentMode[] = ["off", "shadow", "on"];

/**
 * Parses TYPESAFE_JUDGMENTS, a comma-separated list of `name=mode` pairs,
 * e.g. `coverage=shadow,conversation-complete=on`. A dotted judgment such as
 * `coverage.point` inherits from `coverage` unless named itself. `*=mode`
 * sets the default for any judgment not otherwise matched. Unset or empty
 * means everything off.
 */
export function parseJudgmentModes(value: string | undefined): JudgmentModes {
  const modes: Record<string, JudgmentMode> = {};
  if (!value || value.trim() === "") return modes;

  for (const entry of value.split(",")) {
    const trimmed = entry.trim();
    if (trimmed === "") continue;
    const [name, mode, ...rest] = trimmed.split("=").map((part) => part.trim());
    if (!name || !mode || rest.length > 0) {
      throw new Error(
        `Invalid TYPESAFE_JUDGMENTS entry "${trimmed}"; expected name=mode`
      );
    }
    if (!VALID_MODES.includes(mode as JudgmentMode)) {
      throw new Error(
        `Invalid TYPESAFE_JUDGMENTS mode "${mode}" for "${name}"; expected off, shadow or on`
      );
    }
    modes[name] = mode as JudgmentMode;
  }
  return modes;
}

export function resolveJudgmentMode(
  modes: JudgmentModes,
  judgment: string
): JudgmentMode {
  const segments = judgment.split(".");
  for (let length = segments.length; length > 0; length--) {
    const mode = modes[segments.slice(0, length).join(".")];
    if (mode) return mode;
  }
  return modes[WILDCARD] ?? "off";
}
