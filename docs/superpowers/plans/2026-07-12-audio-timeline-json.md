# Audio Timeline JSON Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every `tweedy audio generate` run also writes a sibling `.timeline.json` file with per-speech start/end timestamps in the final mixed audio track.

**Architecture:** `AudioProcessor.concatenateAudio` already computes per-clip start offsets and real-speech-end times internally (via `computeClipOffsets` / `getSpeechEndSeconds`) to build the ffmpeg filter graph, then discards them. This plan makes it return that timing data instead of `void`. `AudioService.generateAudio` then zips the returned timing arrays with the `Speech[]` it already has to build a timeline, and writes it as JSON next to the audio output.

**Tech Stack:** TypeScript, vitest, fluent-ffmpeg, fs-extra.

## Global Constraints

- Timestamps are seconds as floats, rounded to 3 decimals.
- `startSeconds` is the clip's literal offset in the mixed track (interjections legitimately start before the previous clip's `endSeconds` — do not clamp/hide the overlap).
- `entries` order matches `script.speeches` order (chronological turn order), not sorted by `startSeconds`.
- Timeline JSON path = audio output path with its extension swapped for `.timeline.json` (e.g. `podcast-abc123.mp3` → `podcast-abc123.timeline.json`).
- `AudioService.generateAudio`'s existing return type (`Promise<string>`, the audio path) does not change.
- No new CLI flag or command — this is folded into the existing `audio generate` flow.

---

### Task 1: Return timing data from `AudioProcessor.concatenateAudio`

**Files:**
- Modify: `src/providers/AudioProcessor.ts`
- Test: `src/providers/AudioProcessor.test.ts` (create)

**Interfaces:**
- Produces: `export interface ConcatenationTiming { offsetsSeconds: number[]; speechEndSeconds: number[]; }`
- Produces: `AudioProcessor.concatenateAudio(inputFiles: string[], outputPath: string, isInterjection?: boolean[]): Promise<ConcatenationTiming>` (signature unchanged except return type)

- [ ] **Step 1: Write the failing test**

Create `src/providers/AudioProcessor.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ffmpegState = {
  handlers: {} as Record<string, (...args: any[]) => void>,
};

const commandMock: any = {
  input: vi.fn().mockReturnThis(),
  complexFilter: vi.fn().mockReturnThis(),
  output: vi.fn().mockReturnThis(),
  audioFilters: vi.fn().mockReturnThis(),
  format: vi.fn().mockReturnThis(),
  outputOptions: vi.fn().mockReturnThis(),
  on: vi.fn().mockImplementation(function (this: any, event: string, cb: (...args: any[]) => void) {
    ffmpegState.handlers[event] = cb;
    return this;
  }),
  run: vi.fn().mockImplementation(() => {
    // Simulate ffmpeg completing successfully.
    ffmpegState.handlers["end"]?.();
  }),
};

const ffmpegFn: any = vi.fn(() => commandMock);
ffmpegFn.ffprobe = vi.fn((_path: string, cb: (err: unknown, data: any) => void) => {
  cb(null, { format: { duration: 5 } });
});

vi.mock("fluent-ffmpeg", () => ({
  default: ffmpegFn,
}));

vi.mock("fs-extra", () => ({
  ensureDir: vi.fn().mockResolvedValue(undefined),
}));

import { AudioProcessor } from "./AudioProcessor";

describe("AudioProcessor.concatenateAudio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ffmpegState.handlers = {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves with per-clip offsets and speech-end timings instead of void", async () => {
    vi.spyOn(AudioProcessor, "getSpeechEndSeconds")
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);

    const timing = await AudioProcessor.concatenateAudio(
      ["clip1.mp3", "clip2.mp3"],
      "out.mp3",
      [false, false]
    );

    expect(timing).toEqual({
      offsetsSeconds: [0, 2.3],
      speechEndSeconds: [2, 3],
    });
  });

  it("reflects an interjection's overlapping (earlier) offset in the returned timing", async () => {
    vi.spyOn(AudioProcessor, "getSpeechEndSeconds")
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(1);

    const timing = await AudioProcessor.concatenateAudio(
      ["clip1.mp3", "clip2.mp3"],
      "out.mp3",
      [false, true]
    );

    expect(timing.offsetsSeconds).toEqual([0, 3]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/providers/AudioProcessor.test.ts`
Expected: FAIL — `concatenateAudio` currently resolves `undefined`, so `expect(timing).toEqual({...})` fails (or the test fails on `timing.offsetsSeconds` being undefined).

- [ ] **Step 3: Write minimal implementation**

In `src/providers/AudioProcessor.ts`, add the exported interface near the top (after the imports):

```ts
export interface ConcatenationTiming {
  offsetsSeconds: number[];
  speechEndSeconds: number[];
}
```

Change the `concatenateAudio` signature and its `Promise` executor to resolve the timing data instead of nothing:

```ts
  static async concatenateAudio(
    inputFiles: string[],
    outputPath: string,
    isInterjection: boolean[] = inputFiles.map(() => false)
  ): Promise<ConcatenationTiming> {
    try {
      await fs.ensureDir(path.dirname(outputPath));

      const speechEnds = await Promise.all(
        inputFiles.map((file) => AudioProcessor.getSpeechEndSeconds(file))
      );

      const clips: ClipTiming[] = speechEnds.map((speechEndSeconds, i) => ({
        speechEndSeconds,
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
          `${mixInputs}amix=inputs=${inputFiles.length}:dropout_transition=0:normalize=0[mixed]`,
          "[mixed]loudnorm=I=-16:LRA=11:TP=-1.5,silenceremove=1:0:-50dB:1:0:-50dB[out]",
        ].join(";");

        command
          .complexFilter(filterGraph, "out")
          .output(outputPath)
          .on("end", () => {
            logger.info(`Audio concatenated: ${outputPath}`);
            resolve({ offsetsSeconds: offsets, speechEndSeconds: speechEnds });
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

(Only the `Promise<void>` → `Promise<ConcatenationTiming>` return type and the `resolve()` call inside the `end` handler change; the rest of the method body — including comments — stays exactly as it is today.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/providers/AudioProcessor.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/providers/AudioProcessor.ts src/providers/AudioProcessor.test.ts
git commit -m "feat: return per-clip offsets and speech-end timing from concatenateAudio"
```

---

### Task 2: Write timeline JSON from `AudioService.generateAudio`

**Files:**
- Modify: `src/services/AudioService.ts`
- Test: `src/services/AudioService.test.ts` (create)

**Interfaces:**
- Consumes: `AudioProcessor.concatenateAudio(inputFiles: string[], outputPath: string, isInterjection?: boolean[]): Promise<ConcatenationTiming>` from Task 1, where `ConcatenationTiming = { offsetsSeconds: number[]; speechEndSeconds: number[] }`.
- Consumes: `Speech` type fields `id`, `speaker.id`, `speaker.name`, `message`, `tool`, from `src/types/index.ts`.
- Produces: `IAudioService.generateAudio(speeches: Speech[], outputPath: string, scriptId?: string): Promise<string>` (adds optional third parameter; return type and existing two-parameter call sites remain valid).
- Produces: timeline JSON file at `<outputPath with .timeline.json extension>`, written via `fs.writeJson`.

- [ ] **Step 1: Write the failing test**

Create `src/services/AudioService.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockConcatenateAudio = vi.fn();
const mockWriteJson = vi.fn().mockResolvedValue(undefined);

vi.mock("../providers", () => ({
  VocalProviderFactory: { getProvider: vi.fn() },
  AudioProcessor: {
    concatenateAudio: mockConcatenateAudio,
    processAudio: vi.fn(),
  },
}));

vi.mock("fs-extra", () => ({
  writeJson: mockWriteJson,
}));

import { AudioService } from "./AudioService";
import { SpeakerAgentToolName } from "../agents/speaker-tools";
import { VocalProviderName } from "../types";
import type { Speech, Speaker, Voice } from "../types";

function makeVoice(): Voice {
  return {
    id: "voice-1",
    name: "Voice",
    description: "",
    provider: VocalProviderName.ElevenLabs,
    providerId: "provider-id",
    settings: {},
  };
}

function makeSpeaker(id: string, name: string): Speaker {
  return {
    id,
    slug: id,
    name,
    personality: "curious",
    voice: makeVoice(),
    voiceStyle: "neutral",
    isExpert: false,
  };
}

function makeSpeech(overrides: Partial<Speech> = {}): Speech {
  const speaker = makeSpeaker("sp1", "Ada");
  return {
    id: "s1",
    speaker,
    message: "Hello there",
    instructions: "",
    voice: speaker.voice,
    voiceStyle: "neutral",
    timestamp: new Date(),
    tool: SpeakerAgentToolName.SPEAK,
    ...overrides,
  };
}

describe("AudioService.generateAudio timeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes a sibling timeline JSON built from the speeches and concatenation timing", async () => {
    mockConcatenateAudio.mockResolvedValue({
      offsetsSeconds: [0, 2.3],
      speechEndSeconds: [2, 1.5],
    });

    const service = new AudioService();
    vi.spyOn(service as any, "generateSpeechAudio").mockImplementation(
      async (speech: any) => `/audio/speeches/${speech.id}.mp3`
    );

    const speeches = [
      makeSpeech({ id: "s1" }),
      makeSpeech({
        id: "s2",
        tool: SpeakerAgentToolName.INTERJECT,
        speaker: makeSpeaker("sp2", "Bo"),
        message: "Wait, really?",
      }),
    ];

    await service.generateAudio(speeches, "/audio/podcast-abc123.mp3", "abc123");

    expect(mockWriteJson).toHaveBeenCalledWith(
      "/audio/podcast-abc123.timeline.json",
      {
        scriptId: "abc123",
        audioFile: "/audio/podcast-abc123.mp3",
        entries: [
          {
            speechId: "s1",
            speakerId: "sp1",
            speakerName: "Ada",
            message: "Hello there",
            tool: SpeakerAgentToolName.SPEAK,
            isInterjection: false,
            startSeconds: 0,
            endSeconds: 2,
          },
          {
            speechId: "s2",
            speakerId: "sp2",
            speakerName: "Bo",
            message: "Wait, really?",
            tool: SpeakerAgentToolName.INTERJECT,
            isInterjection: true,
            startSeconds: 2.3,
            endSeconds: 3.8,
          },
        ],
      },
      { spaces: 2 }
    );
  });

  it("omits scriptId from the timeline when none is provided", async () => {
    mockConcatenateAudio.mockResolvedValue({
      offsetsSeconds: [0],
      speechEndSeconds: [2],
    });

    const service = new AudioService();
    vi.spyOn(service as any, "generateSpeechAudio").mockResolvedValue(
      "/audio/speeches/s1.mp3"
    );

    await service.generateAudio([makeSpeech({ id: "s1" })], "/audio/podcast.mp3");

    const [, payload] = mockWriteJson.mock.calls[0];
    expect(payload.scriptId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/AudioService.test.ts`
Expected: FAIL — `mockWriteJson` is never called because `generateAudio` doesn't write a timeline yet, and `generateAudio` doesn't accept a third `scriptId` argument.

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `src/services/AudioService.ts` with:

```ts
import { VocalProviderFactory, AudioProcessor } from "../providers";
import { VocalProviderName, Speech, Voice } from "../types";
import { appConfig } from "../utils/config";
import { logger } from "../utils/logger";
import { SpeakerAgentToolName } from "../agents/speaker-tools";
import * as path from "path";
import * as fs from "fs-extra";

export interface IAudioService {
  generateAudio(
    speeches: Speech[],
    outputPath: string,
    scriptId?: string
  ): Promise<string>;
  processAudioFile(inputPath: string, outputPath: string): Promise<void>;
}

interface TimelineEntry {
  speechId: string;
  speakerId: string;
  speakerName: string;
  message: string;
  tool: SpeakerAgentToolName | undefined;
  isInterjection: boolean;
  startSeconds: number;
  endSeconds: number;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function timelinePathFor(outputPath: string): string {
  const dir = path.dirname(outputPath);
  const base = path.basename(outputPath, path.extname(outputPath));
  return path.join(dir, `${base}.timeline.json`);
}

export class AudioService implements IAudioService {
  async generateAudio(
    speeches: Speech[],
    outputPath: string,
    scriptId?: string
  ): Promise<string> {
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
      const timing = await AudioProcessor.concatenateAudio(
        audioFiles,
        outputPath,
        isInterjection
      );

      await this.writeTimeline(speeches, timing, outputPath, scriptId);

      logger.success(`Audio generated: ${outputPath}`);
      return outputPath;
    } catch (error) {
      logger.error("Failed to generate audio:", error);
      throw error;
    }
  }

  async processAudioFile(inputPath: string, outputPath: string): Promise<void> {
    try {
      await AudioProcessor.processAudio(inputPath, outputPath);
      logger.info(`Audio processed: ${outputPath}`);
    } catch (error) {
      logger.error("Failed to process audio file:", error);
      throw error;
    }
  }

  private async writeTimeline(
    speeches: Speech[],
    timing: { offsetsSeconds: number[]; speechEndSeconds: number[] },
    outputPath: string,
    scriptId?: string
  ): Promise<void> {
    const entries: TimelineEntry[] = speeches.map((speech, i) => ({
      speechId: speech.id,
      speakerId: speech.speaker.id,
      speakerName: speech.speaker.name,
      message: speech.message,
      tool: speech.tool,
      isInterjection: speech.tool === SpeakerAgentToolName.INTERJECT,
      startSeconds: round3(timing.offsetsSeconds[i]),
      endSeconds: round3(timing.offsetsSeconds[i] + timing.speechEndSeconds[i]),
    }));

    const timelinePath = timelinePathFor(outputPath);
    await fs.writeJson(
      timelinePath,
      {
        ...(scriptId !== undefined ? { scriptId } : {}),
        audioFile: outputPath,
        entries,
      },
      { spaces: 2 }
    );
    logger.info(`Audio timeline written: ${timelinePath}`);
  }

  private async generateSpeechAudio(speech: Speech): Promise<string> {
    const provider = VocalProviderFactory.getProvider(speech.voice.provider);
    const outputFileName = path.join("speeches", `${speech.id}.mp3`);

    await provider.tts({
      speech,
      voice: speech.voice,
      outputFileName,
    });

    const outputPath = path.join(appConfig.audioDir, outputFileName);
    return outputPath;
  }
}
```

Note: the test's expected `scriptId` key ordering (`scriptId`, `audioFile`, `entries`) matches object spread order above — `toHaveBeenCalledWith` compares by deep equality, not key order, so this is safe either way.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/AudioService.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/AudioService.ts src/services/AudioService.test.ts
git commit -m "feat: write timeline JSON alongside generated audio"
```

---

### Task 3: Pass `scriptId` through from the CLI

**Files:**
- Modify: `src/cli/commands/AudioCommands.ts:53`

**Interfaces:**
- Consumes: `AudioService.generateAudio(speeches: Speech[], outputPath: string, scriptId?: string): Promise<string>` from Task 2.

- [ ] **Step 1: Update the call site**

In `src/cli/commands/AudioCommands.ts`, change:

```ts
        await audioService.generateAudio(script.speeches, outputPath);
```

to:

```ts
        await audioService.generateAudio(script.speeches, outputPath, scriptId);
```

- [ ] **Step 2: Verify the project still type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the full test suite**

Run: `pnpm test`
Expected: all tests pass, including the new `AudioProcessor.test.ts` and `AudioService.test.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/AudioCommands.ts
git commit -m "feat: pass scriptId through to the audio timeline JSON"
```
