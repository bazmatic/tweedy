# Grok Word-Level Timestamps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When generating audio with Grok, capture word-level timestamps from Grok's `with_timestamps` TTS response and include them (track-relative) in the existing per-run `.timeline.json` output.

**Architecture:** `IVocalProvider.tts()` changes its return type from `Promise<string>` to `Promise<TtsResult>` (`{ outputPath, wordTimestamps? }`). Every provider except Grok wraps its existing `outputPath` return in that shape unchanged. `GrokProvider` requests `with_timestamps: true`, receives a JSON envelope instead of raw audio bytes, base64-decodes the audio, and aggregates Grok's per-character timings into word-level timings — masking out effect-tag characters (`[pause]`, `<soft>...</soft>`, etc.) inserted by `addEffectTags` so they don't corrupt word boundaries. `AudioService` threads `wordTimestamps` through to the timeline JSON, shifting each word's times by the clip's offset in the mixed track.

**Tech Stack:** TypeScript, axios, fs-extra, vitest.

## Global Constraints

- Character-level timestamps are never exposed in the timeline JSON — only word-level, aggregated from Grok's character data.
- No new CLI flag or command.
- No timestamp support for any provider other than Grok in this iteration; other providers simply omit `wordTimestamps`.
- Tag character spans are used only to identify what to strip from word aggregation — never surfaced as pseudo-words.
- Timestamp capture must be additive: if Grok's response is missing/malformed `audio_timestamps`, log a warning and return `{ outputPath }` without `wordTimestamps` rather than throwing.
- Word timestamps in the timeline JSON are track-relative (shifted by the clip's own `startSeconds` offset), matching the existing `startSeconds`/`endSeconds` fields on each `TimelineEntry`.
- Timestamps are seconds as floats (Grok returns already-precise floats; no additional rounding requirement beyond what's already done for clip-level `startSeconds`/`endSeconds` via `round3`).

---

### Task 1: `TtsResult`/`WordTimestamp` types and mechanical provider updates

**Files:**
- Modify: `src/types/index.ts:277-286`
- Modify: `src/providers/OpenAIProvider.ts:47-48`
- Modify: `src/providers/ElevenLabsProvider.ts:77-79`
- Modify: `src/providers/HumeProvider.ts:68-70`
- Modify: `src/providers/CartesiaProvider.ts:77-79`
- Modify: `src/providers/KokoroProvider.ts:42-43`
- Modify: `src/providers/BaseVocalProvider.ts:7`
- Test: `src/providers/KokoroProvider.test.ts:70-93`

**Interfaces:**
- Produces: `export interface WordTimestamp { word: string; startSeconds: number; endSeconds: number; }` and `export interface TtsResult { outputPath: string; wordTimestamps?: WordTimestamp[]; }` in `src/types/index.ts`, and `IVocalProvider.tts(params: VocalProviderTtsParams): Promise<TtsResult>`. Consumed by Task 2 (Grok) and Task 3 (AudioService).

- [ ] **Step 1: Add the new types and update `IVocalProvider` in `src/types/index.ts`**

Replace lines 277-286:

```ts
export interface IVocalProvider {
  tts(params: VocalProviderTtsParams): Promise<string>;
  getVoices(): Promise<Voice[]>;
}

export interface VocalProviderTtsParams {
  speech: Speech;
  voice: Voice;
  outputFileName: string;
}
```

with:

```ts
export interface WordTimestamp {
  word: string;
  startSeconds: number;
  endSeconds: number;
}

export interface TtsResult {
  outputPath: string;
  wordTimestamps?: WordTimestamp[];
}

export interface IVocalProvider {
  tts(params: VocalProviderTtsParams): Promise<TtsResult>;
  getVoices(): Promise<Voice[]>;
}

export interface VocalProviderTtsParams {
  speech: Speech;
  voice: Voice;
  outputFileName: string;
}
```

- [ ] **Step 2: Update `BaseVocalProvider`'s abstract signature**

In `src/providers/BaseVocalProvider.ts`, change line 1's import and line 7:

```ts
import { IVocalProvider, VocalProviderTtsParams, TtsResult, Voice } from '../types';
```

```ts
  abstract tts(params: VocalProviderTtsParams): Promise<TtsResult>;
```

- [ ] **Step 3: Update `OpenAIProvider`, `ElevenLabsProvider`, `HumeProvider`, `CartesiaProvider`, `KokoroProvider`**

In each file, change the `tts` signature's return type and the final success return. For `OpenAIProvider.ts` (identical pattern in the other four — same two lines, same `logTtsSuccess(outputPath); return outputPath;` shape):

```ts
  async tts(params: VocalProviderTtsParams): Promise<TtsResult> {
```

and replace:

```ts
      this.logTtsSuccess(outputPath);
      return outputPath;
```

with:

```ts
      this.logTtsSuccess(outputPath);
      return { outputPath };
```

Also add `TtsResult` to each file's import from `'../types'` (alongside the existing `VocalProviderTtsParams, Voice, VocalProviderName` imports).

Apply the same two changes to `ElevenLabsProvider.ts` (around line 33 for the signature, lines 77-79 for the return), `HumeProvider.ts` (line 32 signature, lines 68-70 return), `CartesiaProvider.ts` (line 39 signature, lines 77-79 return), and `KokoroProvider.ts` (line 22 signature, lines 42-43 return).

- [ ] **Step 4: Update `KokoroProvider.test.ts` for the new return shape**

`src/providers/KokoroProvider.test.ts` currently does `const outputPath = await provider.tts(...)` and asserts directly on that string (lines 70-93). Update the "writes synthesized audio to the configured output path" test:

```ts
  it('writes synthesized audio to the configured output path', async () => {
    mockCreate.mockResolvedValue({
      arrayBuffer: async () => new TextEncoder().encode('fake-audio-bytes').buffer,
    });

    const provider = new KokoroProvider();
    const voice = buildVoice();
    const result = await provider.tts({
      speech: buildSpeech(voice),
      voice,
      outputFileName: 'output.mp3',
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'kokoro',
        voice: 'af_heart',
        input: 'Hello from Kokoro',
        response_format: 'mp3',
      })
    );
    expect(fs.writeFile).toHaveBeenCalledWith(result.outputPath, expect.any(Buffer));
    expect(result.outputPath.endsWith('output.mp3')).toBe(true);
    expect(result.wordTimestamps).toBeUndefined();
  });
```

Check the rest of that test file (the "spreads providerOptions into the request body" test and any others) for other places that treat the `tts()` return value as a bare string, and apply the same `.outputPath` adjustment where needed.

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; `KokoroProvider.test.ts` passes. `GrokProvider.test.ts` will fail at this point (still asserting the old `responseType: 'arraybuffer'` behavior) — that's expected and fixed in Task 2.

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/providers/BaseVocalProvider.ts src/providers/OpenAIProvider.ts src/providers/ElevenLabsProvider.ts src/providers/HumeProvider.ts src/providers/CartesiaProvider.ts src/providers/KokoroProvider.ts src/providers/KokoroProvider.test.ts
git commit -m "refactor: change IVocalProvider.tts() to return TtsResult instead of a bare path"
```

---

### Task 2: Word-timestamp aggregation helper

**Files:**
- Create: `src/providers/grok-word-timestamps.ts`
- Test: `src/providers/grok-word-timestamps.test.ts`

**Interfaces:**
- Consumes: nothing beyond plain arrays (no dependency on other tasks).
- Produces: `export function aggregateWordTimestamps(text: string, graphChars: string[], graphTimes: [number, number][]): WordTimestamp[]` — consumed by Task 3 (`GrokProvider.tts`). `WordTimestamp` imported from `../types`.

This isolates the tag-masking/word-splitting logic (independently testable) from the HTTP/axios plumbing in `GrokProvider.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/providers/grok-word-timestamps.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { aggregateWordTimestamps } from "./grok-word-timestamps";

function charTimes(text: string, msPerChar = 60): { chars: string[]; times: [number, number][] } {
  const chars = text.split("");
  const times: [number, number][] = chars.map((_, i) => [
    Math.round(i * msPerChar) / 1000,
    Math.round((i + 1) * msPerChar) / 1000,
  ]);
  return { chars, times };
}

describe("aggregateWordTimestamps", () => {
  it("splits plain text into words with start/end from the first/last character", () => {
    const text = "Hello world.";
    const { chars, times } = charTimes(text);

    const words = aggregateWordTimestamps(text, chars, times);

    expect(words).toEqual([
      { word: "Hello", startSeconds: times[0][0], endSeconds: times[4][1] },
      { word: "world.", startSeconds: times[6][0], endSeconds: times[11][1] },
    ]);
  });

  it("strips inline tags like [pause] and does not emit them as words", () => {
    const text = "Hello [pause] world.";
    const { chars, times } = charTimes(text);

    const words = aggregateWordTimestamps(text, chars, times);

    expect(words.map((w) => w.word)).toEqual(["Hello", "world."]);
  });

  it("strips wrapping tags like <soft>...</soft> and keeps the wrapped words", () => {
    const text = "<soft>Goodnight.</soft>";
    const { chars, times } = charTimes(text);

    const words = aggregateWordTimestamps(text, chars, times);

    expect(words).toEqual([
      {
        word: "Goodnight.",
        startSeconds: times[text.indexOf("Goodnight")][0],
        endSeconds: times[text.indexOf("Goodnight.") + "Goodnight.".length - 1][1],
      },
    ]);
  });

  it("handles multiple tags and stacked wrapping tags around real words", () => {
    const text = "There's your book deal, <slow><soft>Archie</soft></slow>.";
    const { chars, times } = charTimes(text);

    const words = aggregateWordTimestamps(text, chars, times);

    expect(words.map((w) => w.word)).toEqual([
      "There's",
      "your",
      "book",
      "deal,",
      "Archie.",
    ]);
  });

  it("returns an empty array for text that is only tags and whitespace", () => {
    const text = "[pause] [long-pause]";
    const { chars, times } = charTimes(text);

    expect(aggregateWordTimestamps(text, chars, times)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/providers/grok-word-timestamps.test.ts`
Expected: FAIL — `Cannot find module './grok-word-timestamps'`

- [ ] **Step 3: Write the implementation**

Create `src/providers/grok-word-timestamps.ts`:

```ts
import { WordTimestamp } from '../types';

const VALID_INLINE_TAGS = [
  'pause',
  'long-pause',
  'hum-tune',
  'laugh',
  'chuckle',
  'giggle',
  'cry',
  'tsk',
  'tongue-click',
  'lip-smack',
  'breath',
  'inhale',
  'exhale',
  'sigh',
];
const VALID_WRAPPING_TAGS = [
  'soft',
  'whisper',
  'loud',
  'build-intensity',
  'decrease-intensity',
  'higher-pitch',
  'lower-pitch',
  'slow',
  'fast',
  'sing-song',
  'singing',
  'laugh-speak',
  'emphasis',
];
const TAG_PATTERN = new RegExp(
  `\\[(?:${VALID_INLINE_TAGS.join('|')})\\]|</?(?:${VALID_WRAPPING_TAGS.join('|')})>`,
  'g'
);

function buildTagMask(text: string): boolean[] {
  const mask = new Array(text.length).fill(false);
  let match: RegExpExecArray | null;
  const pattern = new RegExp(TAG_PATTERN.source, 'g');
  while ((match = pattern.exec(text))) {
    for (let i = match.index; i < match.index + match[0].length; i++) {
      mask[i] = true;
    }
  }
  return mask;
}

/**
 * Aggregates Grok's per-character `graph_chars`/`graph_times` into word-level
 * timestamps, skipping characters that belong to effect-tag markup (e.g.
 * `[pause]`, `<soft>...</soft>`) inserted by GrokProvider.addEffectTags.
 */
export function aggregateWordTimestamps(
  text: string,
  graphChars: string[],
  graphTimes: [number, number][]
): WordTimestamp[] {
  const mask = buildTagMask(text);
  const words: WordTimestamp[] = [];

  let currentWord = '';
  let wordStart: number | null = null;
  let wordEnd: number | null = null;

  const flush = () => {
    if (currentWord.length > 0 && wordStart !== null && wordEnd !== null) {
      words.push({ word: currentWord, startSeconds: wordStart, endSeconds: wordEnd });
    }
    currentWord = '';
    wordStart = null;
    wordEnd = null;
  };

  for (let i = 0; i < graphChars.length; i++) {
    if (mask[i]) {
      flush();
      continue;
    }
    const char = graphChars[i];
    if (/\s/.test(char)) {
      flush();
      continue;
    }
    if (wordStart === null) {
      wordStart = graphTimes[i][0];
    }
    wordEnd = graphTimes[i][1];
    currentWord += char;
  }
  flush();

  return words;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/providers/grok-word-timestamps.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/providers/grok-word-timestamps.ts src/providers/grok-word-timestamps.test.ts
git commit -m "feat: add tag-aware word-timestamp aggregation for Grok TTS"
```

---

### Task 3: `GrokProvider` — request `with_timestamps`, decode JSON envelope, return `wordTimestamps`

**Files:**
- Modify: `src/providers/GrokProvider.ts`
- Modify: `src/providers/GrokProvider.test.ts`

**Interfaces:**
- Consumes: `aggregateWordTimestamps` from Task 2 (`src/providers/grok-word-timestamps.ts`); `TtsResult`/`WordTimestamp` from Task 1 (`../types`).
- Produces: `GrokProvider.tts()` returning `Promise<TtsResult>` with `wordTimestamps` populated. No change to `GrokProvider.getVoices()`.

- [ ] **Step 1: Update the existing `GrokProvider.test.ts` assertions for the new request/response shape**

Replace the `"posts the expected body and writes the returned audio to disk"` test (lines 36-84) with a version that mocks the JSON envelope response and asserts `with_timestamps: true` plus the decoded `TtsResult`:

```ts
  it("posts the expected body (with_timestamps) and writes the decoded audio to disk", async () => {
    const audioB64 = Buffer.from("audio-bytes").toString("base64");
    (axios.post as any).mockResolvedValue({
      data: {
        audio: audioB64,
        content_type: "audio/mpeg",
        duration: 0.12,
        audio_timestamps: {
          graph_chars: "Hello there.".split(""),
          graph_times: "Hello there.".split("").map((_, i) => [i * 0.06, (i + 1) * 0.06]),
        },
      },
    });

    const provider = new GrokProvider();
    const voice = {
      id: "v1",
      name: "Eve",
      description: "Eve",
      provider: VocalProviderName.Grok,
      providerId: "eve",
      settings: { providerOptions: { speed: 1.2, language: "en" } },
    };
    const speech = {
      id: "s1",
      speaker: {} as any,
      message: "Hello there.",
      instructions: "",
      voice,
      voiceStyle: "",
      timestamp: new Date(),
    };

    const result = await provider.tts({
      speech: speech as any,
      voice: voice as any,
      outputFileName: "out.mp3",
    });

    expect(axios.post).toHaveBeenCalledWith(
      "https://api.x.ai/v1/tts",
      {
        text: "Hello there.",
        voice_id: "eve",
        language: "en",
        output_format: { container: "mp3", sample_rate: 24000 },
        speed: 1.2,
        with_timestamps: true,
      },
      {
        headers: {
          Authorization: "Bearer test-key",
          "Content-Type": "application/json",
        },
      }
    );
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("out.mp3"),
      Buffer.from(audioB64, "base64")
    );
    expect(result.outputPath).toContain("out.mp3");
    expect(result.wordTimestamps).toEqual([
      { word: "Hello", startSeconds: 0, endSeconds: 5 * 0.06 },
      { word: "there.", startSeconds: 6 * 0.06, endSeconds: 11 * 0.06 + 0.06 },
    ]);
  });
```

Update the `"defaults language to 'auto' and omits speed..."` test (lines 86-125) to also mock the JSON envelope shape (reuse the same `data: { audio, audio_timestamps: {...} }` structure) and add `with_timestamps: true` to the expected posted body, and drop the `responseType: 'arraybuffer'` expectation there too (replace `expect.any(Object)` calls' surrounding config object to no longer require `responseType`).

For the remaining tests in the file (`"sends LLM-tagged text..."`, `"falls back to the original message..."` x4) — each currently does `(axios.post as any).mockResolvedValue({ data: arrayBuffer })` with `responseType: 'arraybuffer'`. Update each mock to:

```ts
    (axios.post as any).mockResolvedValue({
      data: {
        audio: Buffer.from("audio-bytes").toString("base64"),
        audio_timestamps: { graph_chars: [], graph_times: [] },
      },
    });
```

(An empty `graph_chars`/`graph_times` is fine for these tests — they only assert on the posted request body, not on `wordTimestamps`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/providers/GrokProvider.test.ts`
Expected: FAIL — actual `GrokProvider.tts()` still posts with `responseType: 'arraybuffer'` and returns a bare string.

- [ ] **Step 3: Implement the changes in `GrokProvider.ts`**

Add the import (top of file, alongside existing imports):

```ts
import { aggregateWordTimestamps } from './grok-word-timestamps';
import { VocalProviderTtsParams, Voice, VocalProviderName, TtsResult } from '../types';
```

(replacing the existing `import { VocalProviderTtsParams, Voice, VocalProviderName } from '../types';` line)

Replace the `tts` method body (lines 141-175):

```ts
  async tts(params: VocalProviderTtsParams): Promise<TtsResult> {
    this.validateParams(params);
    this.logTtsRequest(params);

    try {
      const outputPath = path.join(appConfig.audioDir, params.outputFileName);
      await fs.ensureDir(path.dirname(outputPath));

      const options = params.voice.settings.providerOptions || {};
      const text = await this.addEffectTags(params.speech.message);

      const response = await axios.post(
        `${this.baseUrl}/tts`,
        {
          text,
          voice_id: params.voice.providerId,
          language: options.language ?? 'auto',
          output_format: { container: 'mp3', sample_rate: 24000 },
          ...(options.speed !== undefined ? { speed: options.speed } : {}),
          with_timestamps: true,
        },
        {
          headers: this.headers,
        }
      );

      const audioBuffer = Buffer.from(response.data.audio, 'base64');
      await fs.writeFile(outputPath, audioBuffer);
      this.logTtsSuccess(outputPath);

      const wordTimestamps = this.extractWordTimestamps(text, response.data);

      return wordTimestamps ? { outputPath, wordTimestamps } : { outputPath };
    } catch (error) {
      this.logTtsError(error);
      throw error;
    }
  }

  private extractWordTimestamps(
    text: string,
    responseData: any
  ): ReturnType<typeof aggregateWordTimestamps> | undefined {
    const timestamps = responseData?.audio_timestamps;
    if (
      !timestamps ||
      !Array.isArray(timestamps.graph_chars) ||
      !Array.isArray(timestamps.graph_times)
    ) {
      logger.warn('Grok TTS response missing audio_timestamps, skipping word timestamps');
      return undefined;
    }
    try {
      return aggregateWordTimestamps(text, timestamps.graph_chars, timestamps.graph_times);
    } catch (error) {
      logger.warn('Failed to aggregate Grok word timestamps, skipping:', error);
      return undefined;
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/providers/GrokProvider.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: all pass (Task 1's `KokoroProvider.test.ts` update plus this task's `GrokProvider.test.ts` update both green; `AudioService.test.ts` will fail at this point since `generateSpeechAudio`'s mocked return shape hasn't changed yet — expected, fixed in Task 4).

- [ ] **Step 6: Commit**

```bash
git add src/providers/GrokProvider.ts src/providers/GrokProvider.test.ts
git commit -m "feat: request with_timestamps from Grok TTS and return word-level timestamps"
```

---

### Task 4: Thread `wordTimestamps` through `AudioService` into the timeline JSON

**Files:**
- Modify: `src/services/AudioService.ts`
- Modify: `src/services/AudioService.test.ts`

**Interfaces:**
- Consumes: `TtsResult` from Task 1 (`../types`); `GrokProvider`'s populated `wordTimestamps` from Task 3 (indirectly, via `VocalProviderFactory.getProvider(...).tts(...)`).
- Produces: `TimelineEntry.wordTimestamps?: { word: string; startSeconds: number; endSeconds: number }[]`, written to the `.timeline.json` file, track-relative.

- [ ] **Step 1: Write the failing test**

In `src/services/AudioService.test.ts`, add a new test after the existing `"writes a sibling timeline JSON..."` test (after line 123), and update the existing tests' `generateSpeechAudio` mocks to return the new `TtsResult` shape instead of a bare string:

Update the first test (lines 70-123): change

```ts
    vi.spyOn(service as any, "generateSpeechAudio").mockImplementation(
      async (speech: any) => `/audio/speeches/${speech.id}.mp3`
    );
```

to

```ts
    vi.spyOn(service as any, "generateSpeechAudio").mockImplementation(
      async (speech: any) => ({ outputPath: `/audio/speeches/${speech.id}.mp3` })
    );
```

The existing expected `entries` in that test are unaffected (no `wordTimestamps` on either speech), since `wordTimestamps` should be omitted, not written as an empty array — no other change needed there.

Update the second test (lines 125-140): change

```ts
    vi.spyOn(service as any, "generateSpeechAudio").mockResolvedValue(
      "/audio/speeches/s1.mp3"
    );
```

to

```ts
    vi.spyOn(service as any, "generateSpeechAudio").mockResolvedValue({
      outputPath: "/audio/speeches/s1.mp3",
    });
```

Add a new test:

```ts
  it("shifts word timestamps by the clip's offset and includes them per entry", async () => {
    mockConcatenateAudio.mockResolvedValue({
      offsetsSeconds: [0, 2.3],
      speechEndSeconds: [2, 1.5],
    });

    const service = new AudioService();
    vi.spyOn(service as any, "generateSpeechAudio").mockImplementation(
      async (speech: any) => {
        if (speech.id === "s2") {
          return {
            outputPath: "/audio/speeches/s2.mp3",
            wordTimestamps: [
              { word: "Hello", startSeconds: 0, endSeconds: 0.3 },
              { word: "there", startSeconds: 0.3, endSeconds: 0.6 },
            ],
          };
        }
        return { outputPath: "/audio/speeches/s1.mp3" };
      }
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

    const [, payload] = mockWriteJson.mock.calls[0];
    // s2's clip offset (offsetsSeconds[1]) is 2.3, so its word timestamps
    // must be shifted from clip-relative to track-relative seconds.
    expect(payload.entries[1].wordTimestamps).toEqual([
      { word: "Hello", startSeconds: 2.3, endSeconds: 2.6 },
      { word: "there", startSeconds: 2.6, endSeconds: 2.9 },
    ]);
    expect(payload.entries[0].wordTimestamps).toBeUndefined();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/AudioService.test.ts`
Expected: FAIL — `AudioService` doesn't yet read or shift `wordTimestamps`, and `generateSpeechAudio`'s real implementation still returns a bare string.

- [ ] **Step 3: Implement in `AudioService.ts`**

Update the `TimelineEntry` interface (lines 18-27):

```ts
interface TimelineEntry {
  speechId: string;
  speakerId: string;
  speakerName: string;
  message: string;
  tool: SpeakerAgentToolName | undefined;
  isInterjection: boolean;
  startSeconds: number;
  endSeconds: number;
  wordTimestamps?: { word: string; startSeconds: number; endSeconds: number }[];
}
```

Update the import at the top (line 2) to bring in `TtsResult`:

```ts
import { VocalProviderName, Speech, Voice, TtsResult } from "../types";
```

Update `generateSpeechAudio` (lines 123-135) to return the full `TtsResult` instead of unwrapping to a bare path:

```ts
  private async generateSpeechAudio(speech: Speech): Promise<TtsResult> {
    const provider = VocalProviderFactory.getProvider(speech.voice.provider);
    const outputFileName = path.join("speeches", `${speech.id}.mp3`);

    return provider.tts({
      speech,
      voice: speech.voice,
      outputFileName,
    });
  }
```

Update `generateAudio` (lines 40-81) to collect `TtsResult[]` instead of `string[]`, passing only the paths to `AudioProcessor.concatenateAudio` and keeping the full results for the timeline:

```ts
  async generateAudio(
    speeches: Speech[],
    outputPath: string,
    scriptId?: string
  ): Promise<string> {
    try {
      logger.info(`Generating audio for ${speeches.length} speeches`);

      const ttsResults: TtsResult[] = [];
      const batchSize = 1;

      // Process speeches in batches
      for (let i = 0; i < speeches.length; i += batchSize) {
        const batch = speeches.slice(i, i + batchSize);
        const batchPromises = batch.map((speech) =>
          this.generateSpeechAudio(speech)
        );
        const batchResults = await Promise.all(batchPromises);
        ttsResults.push(...batchResults);
      }

      const audioFiles = ttsResults.map((result) => result.outputPath);

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

      await this.writeTimeline(speeches, ttsResults, timing, outputPath, scriptId);

      logger.success(`Audio generated: ${outputPath}`);
      return outputPath;
    } catch (error) {
      logger.error("Failed to generate audio:", error);
      throw error;
    }
  }
```

Update `writeTimeline` (lines 93-121) to accept `ttsResults` and shift each entry's `wordTimestamps` by that entry's `startSeconds` offset:

```ts
  private async writeTimeline(
    speeches: Speech[],
    ttsResults: TtsResult[],
    timing: { offsetsSeconds: number[]; speechEndSeconds: number[] },
    outputPath: string,
    scriptId?: string
  ): Promise<void> {
    const entries: TimelineEntry[] = speeches.map((speech, i) => {
      const startSeconds = round3(timing.offsetsSeconds[i]);
      const wordTimestamps = ttsResults[i].wordTimestamps?.map((w) => ({
        word: w.word,
        startSeconds: round3(startSeconds + w.startSeconds),
        endSeconds: round3(startSeconds + w.endSeconds),
      }));

      return {
        speechId: speech.id,
        speakerId: speech.speaker.id,
        speakerName: speech.speaker.name,
        message: speech.message,
        tool: speech.tool,
        isInterjection: speech.tool === SpeakerAgentToolName.INTERJECT,
        startSeconds,
        endSeconds: round3(timing.offsetsSeconds[i] + timing.speechEndSeconds[i]),
        ...(wordTimestamps ? { wordTimestamps } : {}),
      };
    });

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/AudioService.test.ts`
Expected: PASS (all tests, including the new one)

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/services/AudioService.ts src/services/AudioService.test.ts
git commit -m "feat: include track-relative word timestamps in the audio timeline JSON"
```

---

### Task 5: Update README documentation

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing (docs-only task).
- Produces: nothing consumed by other tasks; final task in the plan.

- [ ] **Step 1: Find the existing timeline JSON documentation**

Run: `grep -n "timeline" README.md`

- [ ] **Step 2: Add a note about word-level timestamps for Grok**

In the section documenting the `.timeline.json` output (added per the `2026-07-12-audio-timeline-json` plan), add a short paragraph after the existing description of `entries`/`startSeconds`/`endSeconds`:

```markdown
When a speech is generated with a voice provider that supports word-level timing (currently Grok only), its timeline entry also includes a `wordTimestamps` array — `{ word, startSeconds, endSeconds }` per word, already shifted to the same track-relative seconds as the entry's own `startSeconds`/`endSeconds`. Entries from providers without timing support omit this field entirely.
```

Adjust the exact wording/placement to match the surrounding doc's style once you've located it in Step 1.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document word-level timestamps for Grok in the timeline JSON"
```
