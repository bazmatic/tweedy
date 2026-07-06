# Overlapping Interjections Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make interjection speeches audibly cut in before the preceding speaker finishes, instead of playing back-to-back like every other turn.

**Architecture:** Add a pure `computeClipOffsets` function that turns an ordered list of `{ durationSeconds, isInterjection }` clips into start-offset timestamps (interjections start 0.4s before the previous clip ends; everything else is unchanged sequential concatenation). Replace the ffmpeg concat-demuxer call in `AudioProcessor.concatenateAudio` with a `filter_complex` graph (`adelay` per clip + `amix`) driven by those offsets, fed by clip durations already obtainable via the existing `getAudioDuration`. Thread the `INTERJECT` flag from `Speech.tool` through `AudioService.generateAudio` into the new concatenation call.

**Tech Stack:** TypeScript, fluent-ffmpeg, Vitest (new dev dependency — no test framework exists in this repo yet).

---

## Chunk 1: Test framework + offset computation

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (add `vitest` devDependency, add `test` script)
- Create: `src/providers/audio-timeline.ts`
- Test: `src/providers/audio-timeline.test.ts`

- [ ] **Step 1: Install Vitest**

```bash
pnpm add -D vitest
```

- [ ] **Step 2: Add Vitest config**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 3: Add `test` script to `package.json`**

In the `"scripts"` block, add:

```json
"test": "vitest run"
```

- [ ] **Step 4: Write the failing test for `computeClipOffsets`**

Create `src/providers/audio-timeline.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { computeClipOffsets, OVERLAP_SECONDS, ClipTiming } from "./audio-timeline";

describe("computeClipOffsets", () => {
  it("places sequential clips back-to-back when none are interjections", () => {
    const clips: ClipTiming[] = [
      { durationSeconds: 2, isInterjection: false },
      { durationSeconds: 3, isInterjection: false },
      { durationSeconds: 1.5, isInterjection: false },
    ];

    expect(computeClipOffsets(clips)).toEqual([0, 2, 5]);
  });

  it("starts an interjection OVERLAP_SECONDS before the previous clip ends", () => {
    const clips: ClipTiming[] = [
      { durationSeconds: 4, isInterjection: false },
      { durationSeconds: 1, isInterjection: true },
    ];

    expect(computeClipOffsets(clips)).toEqual([0, 4 - OVERLAP_SECONDS]);
  });

  it("resumes the clip after an interjection when the interjection ends, without compounding overlap", () => {
    const clips: ClipTiming[] = [
      { durationSeconds: 4, isInterjection: false },
      { durationSeconds: 1, isInterjection: true },
      { durationSeconds: 3, isInterjection: false },
    ];

    const interjectionOffset = 4 - OVERLAP_SECONDS;
    expect(computeClipOffsets(clips)).toEqual([
      0,
      interjectionOffset,
      interjectionOffset + 1,
    ]);
  });

  it("clamps the interjection offset to zero when the previous clip is shorter than the overlap", () => {
    const clips: ClipTiming[] = [
      { durationSeconds: 0.1, isInterjection: false },
      { durationSeconds: 1, isInterjection: true },
    ];

    expect(computeClipOffsets(clips)).toEqual([0, 0]);
  });

  it("returns an empty array for no clips", () => {
    expect(computeClipOffsets([])).toEqual([]);
  });

  it("keeps the first clip at zero even if it is flagged as an interjection", () => {
    const clips: ClipTiming[] = [
      { durationSeconds: 2, isInterjection: true },
      { durationSeconds: 3, isInterjection: false },
    ];

    expect(computeClipOffsets(clips)).toEqual([0, 2]);
  });

  it("handles consecutive interjections, each overlapping the one before it", () => {
    const clips: ClipTiming[] = [
      { durationSeconds: 4, isInterjection: false },
      { durationSeconds: 1, isInterjection: true },
      { durationSeconds: 1, isInterjection: true },
    ];

    const firstInterjectionOffset = 4 - OVERLAP_SECONDS;
    const secondInterjectionOffset = Math.max(
      0,
      firstInterjectionOffset + 1 - OVERLAP_SECONDS
    );
    expect(computeClipOffsets(clips)).toEqual([
      0,
      firstInterjectionOffset,
      secondInterjectionOffset,
    ]);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './audio-timeline'` (file doesn't exist yet)

- [ ] **Step 6: Implement `computeClipOffsets`**

Create `src/providers/audio-timeline.ts`:

```typescript
export const OVERLAP_SECONDS = 0.4;

export interface ClipTiming {
  durationSeconds: number;
  isInterjection: boolean;
}

export function computeClipOffsets(clips: ClipTiming[]): number[] {
  const offsets: number[] = [];

  for (let i = 0; i < clips.length; i++) {
    if (i === 0) {
      offsets.push(0);
      continue;
    }

    const previous = clips[i - 1];
    const previousEnd = offsets[i - 1] + previous.durationSeconds;

    offsets.push(
      clips[i].isInterjection
        ? Math.max(0, previousEnd - OVERLAP_SECONDS)
        : previousEnd
    );
  }

  return offsets;
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm test`
Expected: PASS (5 tests)

- [ ] **Step 8: Commit**

```bash
git add vitest.config.ts package.json pnpm-lock.yaml src/providers/audio-timeline.ts src/providers/audio-timeline.test.ts
git commit -m "feat: add clip offset computation for overlapping interjections"
```

---

## Chunk 2: Wire offsets into ffmpeg rendering

**Files:**
- Modify: `src/providers/AudioProcessor.ts:39-82` (replace `concatenateAudio` body)
- Modify: `src/services/AudioService.ts:13-63` (pass per-clip interjection flags through)
- Modify: `src/providers/index.ts` (export new type if it re-exports `AudioProcessor` members — check first)

- [ ] **Step 1: Check how `AudioProcessor` is exported**

Run: `grep -n "AudioProcessor" src/providers/index.ts`

Confirm whether `concatenateAudio`'s signature change needs re-exporting anything extra. No action needed unless the file re-exports named types — in that case add the new type export alongside.

- [ ] **Step 2: Change `concatenateAudio` signature and implementation**

Replace the whole `concatenateAudio` method in `src/providers/AudioProcessor.ts` (currently lines 39-82):

```typescript
static async concatenateAudio(
  inputFiles: string[],
  outputPath: string,
  isInterjection: boolean[] = inputFiles.map(() => false)
): Promise<void> {
  try {
    await fs.ensureDir(path.dirname(outputPath));

    const durations = await Promise.all(
      inputFiles.map((file) => AudioProcessor.getAudioDuration(file))
    );

    const clips: ClipTiming[] = durations.map((durationSeconds, i) => ({
      durationSeconds,
      isInterjection: isInterjection[i] ?? false,
    }));

    const offsets = computeClipOffsets(clips);

    return new Promise((resolve, reject) => {
      const command = ffmpeg();
      inputFiles.forEach((file) => command.input(file));

      const delayedLabels = offsets.map((offsetSeconds, i) => {
        const offsetMs = Math.round(offsetSeconds * 1000);
        const label = `a${i}`;
        return { filter: `[${i}:a]adelay=${offsetMs}|${offsetMs}[${label}]`, label };
      });

      const mixInputs = delayedLabels.map(({ label }) => `[${label}]`).join("");
      const filterGraph = [
        ...delayedLabels.map(({ filter }) => filter),
        // normalize=0: amix defaults to dividing volume by input count, which
        // would quietly attenuate every clip, not just overlapping ones.
        // loudnorm below re-normalizes levels anyway, so skip amix's own scaling.
        `${mixInputs}amix=inputs=${inputFiles.length}:dropout_transition=0:normalize=0[mixed]`,
      ].join(";");

      command
        .complexFilter(filterGraph, "mixed")
        .outputOptions([
          // A single -af with both filters comma-separated — passing -af twice
          // means ffmpeg only honours the last one, silently dropping loudnorm.
          "-af",
          "loudnorm=I=-16:LRA=11:TP=-1.5,silenceremove=1:0:-50dB:1:0:-50dB",
        ])
        .output(outputPath)
        .on("end", () => {
          logger.info(`Audio concatenated: ${outputPath}`);
          resolve();
        })
        .on("error", (error: Error) => {
          logger.error("Audio concatenation failed:", error);
          reject(error);
        })
        .run();
    });
  } catch (error) {
    logger.error("Failed to concatenate audio:", error);
    throw error;
  }
}
```

Add the import at the top of `src/providers/AudioProcessor.ts`:

```typescript
import { computeClipOffsets, ClipTiming } from "./audio-timeline";
```

Note: this drops the old `concat_list.txt` temp-file approach entirely — `filter_complex` takes inputs directly, so there's no list file to clean up.

- [ ] **Step 3: Update `AudioService.generateAudio` to pass interjection flags**

In `src/services/AudioService.ts`, change the `generateAudio` method (currently lines 13-39) to track which speeches are interjections and pass that through:

```typescript
async generateAudio(speeches: Speech[], outputPath: string): Promise<string> {
  try {
    logger.info(`Generating audio for ${speeches.length} speeches`);

    const audioFiles: string[] = [];
    const batchSize = 1;

    // Process speeches in batches
    for (let i = 0; i < speeches.length; i += batchSize) {
      const batch = speeches.slice(i, i + batchSize);
      const batchPromises = batch.map((speech) =>
        this.generateSpeechAudio(speech)
      );
      const batchResults = await Promise.all(batchPromises);
      audioFiles.push(...batchResults);
    }

    const isInterjection = speeches.map(
      (speech) => speech.tool === SpeakerAgentToolName.INTERJECT
    );

    // Concatenate all audio files, overlapping interjections with the
    // preceding clip so they sound like a natural cut-in.
    await AudioProcessor.concatenateAudio(audioFiles, outputPath, isInterjection);

    logger.success(`Audio generated: ${outputPath}`);
    return outputPath;
  } catch (error) {
    logger.error("Failed to generate audio:", error);
    throw error;
  }
}
```

Add the import at the top of `src/services/AudioService.ts`:

```typescript
import { SpeakerAgentToolName } from "../agents/speaker-tools";
```

- [ ] **Step 4: Type-check the project**

Run: `pnpm build`
Expected: no TypeScript errors

- [ ] **Step 5: Run the existing unit tests to confirm nothing broke**

Run: `pnpm test`
Expected: PASS (same tests as Chunk 1 — this chunk has no new automated tests since it's ffmpeg process wiring; correctness of the actual rendered audio is verified manually in Step 6)

- [ ] **Step 6: Manual smoke test**

Run the CLI's existing audio-generation command end-to-end on a script that contains at least one interjection (check `src/cli/commands/AudioCommands.ts` for the exact command name). Listen to the output and confirm:
- The interjection is audible starting before the prior speaker's line ends.
- The prior speaker's words aren't clipped or unintelligible.
- Non-interjection transitions still sound like a clean cut with no overlap.

- [ ] **Step 7: Commit**

```bash
git add src/providers/AudioProcessor.ts src/services/AudioService.ts
git commit -m "feat: overlap interjection audio with preceding speech during render"
```

---

## Chunk 3: Cleanup check

**Files:**
- Modify: `src/providers/AudioProcessor.ts` (only if dead code remains)

- [ ] **Step 1: Confirm no leftover references to the old concat-list approach**

Run: `grep -n "concat_list" -r src`
Expected: no matches (the temp file list is no longer used anywhere)

- [ ] **Step 2: Confirm `fs-extra`'s `fs.remove` import isn't now unused in `AudioProcessor.ts`**

Run: `grep -n "fs\." src/providers/AudioProcessor.ts`

If `fs` is still used elsewhere in the file (e.g. `fs.ensureDir`), no change needed. If not, remove the unused import.

- [ ] **Step 3: Final full test + build run**

Run: `pnpm test && pnpm build`
Expected: both succeed

- [ ] **Step 4: Commit (only if Step 2 required a change)**

```bash
git add src/providers/AudioProcessor.ts
git commit -m "chore: remove unused import after concat-list removal"
```
