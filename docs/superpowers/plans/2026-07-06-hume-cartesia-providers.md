# Hume and Cartesia Voice Providers Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add working `HumeProvider` and `CartesiaProvider` implementations of `IVocalProvider`, wire them into `VocalProviderFactory`, and preserve each provider's emotional-expressiveness controls, per `docs/superpowers/specs/2026-07-06-hume-cartesia-providers-design.md`.

**Architecture:** Both providers extend `BaseVocalProvider` (same shape as `ElevenLabsProvider`/`OpenAIProvider`): read an API key from env at construction, implement `tts()` (POST request → write audio file to `appConfig.audioDir`) and `getVoices()` (GET request → map to `Voice[]`). A new `providerOptions?: Record<string, unknown>` field on `VoiceSettings` carries provider-specific knobs (Cartesia's `emotion`/`volume`, both providers' `speed`) that don't fit the existing shared fields.

**Tech Stack:** TypeScript, axios (already a dependency), existing `appConfig`/`logger` utils.

**Note on testing:** This codebase has no test framework configured (no jest/vitest, no existing `*.test.ts` files). Introducing one is out of scope for this change (YAGNI — would be a separate, larger decision). Verification instead uses `tsc` type-checking (`npm run build`) after each step, plus a manual CLI smoke test at the end using real API keys if available. This matches how `ElevenLabsProvider`/`OpenAIProvider` were verified.

---

## Chunk 1: Types and Hume provider

### Task 1: Add `Cartesia` enum value and `providerOptions` field

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add the enum value**

In `src/types/index.ts`, find:
```ts
export enum VocalProviderName {
  ElevenLabs = "elevenlabs",
  OpenAI = "openai",
  Hume = "hume",
}
```
Change to:
```ts
export enum VocalProviderName {
  ElevenLabs = "elevenlabs",
  OpenAI = "openai",
  Hume = "hume",
  Cartesia = "cartesia",
}
```

- [ ] **Step 2: Add `providerOptions` to `VoiceSettings`**

Find:
```ts
export interface VoiceSettings {
  stability?: number;
  similarityBoost?: number;
  style?: string;
  instructions?: string;
}
```
Change to:
```ts
export interface VoiceSettings {
  stability?: number;
  similarityBoost?: number;
  style?: string;
  instructions?: string;
  /** Provider-specific TTS options that don't have a shared equivalent
   * (e.g. Cartesia's `emotion`/`volume`, either provider's `speed`). */
  providerOptions?: Record<string, unknown>;
}
```

- [ ] **Step 3: Type-check**

Run: `npm run build`
Expected: succeeds with no errors (nothing yet references the new members incorrectly).

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add Cartesia provider enum and providerOptions to VoiceSettings"
```

---

### Task 2: Implement `HumeProvider`

**Files:**
- Create: `src/providers/HumeProvider.ts`

- [ ] **Step 1: Write the provider**

```ts
import axios from 'axios';
import * as fs from 'fs-extra';
import * as path from 'path';
import { BaseVocalProvider } from './BaseVocalProvider';
import { VocalProviderTtsParams, Voice, VocalProviderName } from '../types';
import { appConfig } from '../utils/config';
import { logger } from '../utils/logger';

export class HumeProvider extends BaseVocalProvider {
  private apiKey: string;
  private baseUrl = 'https://api.hume.ai/v0';

  constructor() {
    super();
    this.apiKey = process.env.HUME_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('HUME_API_KEY environment variable is required');
    }
  }

  protected getProviderName(): string {
    return 'Hume';
  }

  async tts(params: VocalProviderTtsParams): Promise<string> {
    this.validateParams(params);
    this.logTtsRequest(params);

    try {
      const outputPath = path.join(appConfig.audioDir, params.outputFileName);
      await fs.ensureDir(path.dirname(outputPath));

      const speed = params.voice.settings.providerOptions?.speed;

      const response = await axios.post(
        `${this.baseUrl}/tts`,
        {
          utterances: [
            {
              text: params.speech.message,
              voice: { id: params.voice.providerId },
              description: params.voice.settings.instructions,
              ...(speed !== undefined ? { speed } : {}),
            },
          ],
        },
        {
          headers: {
            'X-Hume-Api-Key': this.apiKey,
            'Content-Type': 'application/json',
          },
        }
      );

      const base64Audio = response.data.generations?.[0]?.audio;
      if (!base64Audio) {
        throw new Error('Hume TTS response did not contain audio data');
      }

      await fs.writeFile(outputPath, Buffer.from(base64Audio, 'base64'));
      this.logTtsSuccess(outputPath);

      return outputPath;
    } catch (error) {
      this.logTtsError(error);
      throw error;
    }
  }

  async getVoices(): Promise<Voice[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/tts/voices`, {
        headers: {
          'X-Hume-Api-Key': this.apiKey,
        },
      });

      const voices = response.data.voices_page ?? response.data.voices ?? [];

      return voices.map((voice: any) => ({
        id: voice.id,
        name: voice.name,
        description: voice.name,
        provider: VocalProviderName.Hume,
        providerId: voice.id,
        settings: {},
      }));
    } catch (error) {
      logger.error('Failed to get Hume voices:', error);
      throw error;
    }
  }
}
```

**Note for implementer:** Hume's exact response envelope for `/v0/tts` (field names for the generations/audio array) and the voices-list path were not independently confirmed against a live account during design (see spec's "Open items to verify" section). Before considering this task done, run a real smoke test (Task 7) and adjust field names (`response.data.generations[0].audio` etc.) to match the actual response if they differ.

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/providers/HumeProvider.ts
git commit -m "feat: implement HumeProvider for text-to-speech"
```

---

## Chunk 2: Cartesia provider and wiring

### Task 3: Implement `CartesiaProvider`

**Files:**
- Create: `src/providers/CartesiaProvider.ts`

- [ ] **Step 1: Write the provider**

```ts
import axios from 'axios';
import * as fs from 'fs-extra';
import * as path from 'path';
import { BaseVocalProvider } from './BaseVocalProvider';
import { VocalProviderTtsParams, Voice, VocalProviderName } from '../types';
import { appConfig } from '../utils/config';
import { logger } from '../utils/logger';

const CARTESIA_API_VERSION = '2025-04-16';

export class CartesiaProvider extends BaseVocalProvider {
  private apiKey: string;
  private baseUrl = 'https://api.cartesia.ai';

  constructor() {
    super();
    this.apiKey = process.env.CARTESIA_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('CARTESIA_API_KEY environment variable is required');
    }
  }

  protected getProviderName(): string {
    return 'Cartesia';
  }

  private get headers() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Cartesia-Version': CARTESIA_API_VERSION,
      'Content-Type': 'application/json',
    };
  }

  async tts(params: VocalProviderTtsParams): Promise<string> {
    this.validateParams(params);
    this.logTtsRequest(params);

    try {
      const outputPath = path.join(appConfig.audioDir, params.outputFileName);
      await fs.ensureDir(path.dirname(outputPath));

      const options = params.voice.settings.providerOptions || {};
      const generationConfig: Record<string, unknown> = {};
      if (options.emotion !== undefined) generationConfig.emotion = options.emotion;
      if (options.speed !== undefined) generationConfig.speed = options.speed;
      if (options.volume !== undefined) generationConfig.volume = options.volume;

      const response = await axios.post(
        `${this.baseUrl}/tts/bytes`,
        {
          model_id: 'sonic-3',
          transcript: params.speech.message,
          voice: { mode: 'id', id: params.voice.providerId },
          output_format: {
            container: 'mp3',
            sample_rate: 44100,
          },
          ...(Object.keys(generationConfig).length > 0
            ? { generation_config: generationConfig }
            : {}),
        },
        {
          headers: this.headers,
          responseType: 'arraybuffer',
        }
      );

      await fs.writeFile(outputPath, response.data);
      this.logTtsSuccess(outputPath);

      return outputPath;
    } catch (error) {
      this.logTtsError(error);
      throw error;
    }
  }

  async getVoices(): Promise<Voice[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/voices`, {
        headers: this.headers,
      });

      const voices = response.data.data ?? response.data;

      return voices.map((voice: any) => ({
        id: voice.id,
        name: voice.name,
        description: voice.description || voice.name,
        provider: VocalProviderName.Cartesia,
        providerId: voice.id,
        settings: {},
      }));
    } catch (error) {
      logger.error('Failed to get Cartesia voices:', error);
      throw error;
    }
  }
}
```

**Note for implementer:** as with Hume, `/voices` response shape (whether list items are top-level or under `data`) was not independently confirmed live — verify and adjust in Task 7.

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/providers/CartesiaProvider.ts
git commit -m "feat: implement CartesiaProvider for text-to-speech"
```

---

### Task 4: Wire both providers into the factory and barrel export

**Files:**
- Modify: `src/providers/VocalProviderFactory.ts`
- Modify: `src/providers/index.ts`

- [ ] **Step 1: Update the factory**

In `src/providers/VocalProviderFactory.ts`, change the imports:
```ts
import { IVocalProvider, VocalProviderName } from '../types';
import { ElevenLabsProvider } from './ElevenLabsProvider';
import { OpenAIProvider } from './OpenAIProvider';
import { HumeProvider } from './HumeProvider';
import { CartesiaProvider } from './CartesiaProvider';
import { logger } from '../utils/logger';
```

Replace the `switch` body:
```ts
      switch (provider) {
        case VocalProviderName.ElevenLabs:
          this.providers.set(provider, new ElevenLabsProvider());
          break;
        case VocalProviderName.OpenAI:
          this.providers.set(provider, new OpenAIProvider());
          break;
        case VocalProviderName.Hume:
          this.providers.set(provider, new HumeProvider());
          break;
        case VocalProviderName.Cartesia:
          this.providers.set(provider, new CartesiaProvider());
          break;
        default:
          throw new Error(`Unknown vocal provider: ${provider}`);
      }
```

- [ ] **Step 2: Update the barrel export**

In `src/providers/index.ts`, add:
```ts
export { HumeProvider } from './HumeProvider';
export { CartesiaProvider } from './CartesiaProvider';
```

- [ ] **Step 3: Type-check**

Run: `npm run build`
Expected: succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/providers/VocalProviderFactory.ts src/providers/index.ts
git commit -m "feat: wire HumeProvider and CartesiaProvider into VocalProviderFactory"
```

---

### Task 5: Update CLI help text to mention new providers

**Files:**
- Modify: `src/cli/commands/VoiceCommands.ts`

- [ ] **Step 1: Update option descriptions**

In `src/cli/commands/VoiceCommands.ts`, the `add` command has:
```ts
    .option(
      "-p, --provider <provider>",
      "Voice provider (elevenlabs, openai)",
      "elevenlabs"
    )
```
Change the description string to:
```ts
      "Voice provider (elevenlabs, openai, hume, cartesia)",
```

The `import` command has the same pattern — update it identically:
```ts
    .option(
      "-p, --provider <provider>",
      "Provider to import from (elevenlabs, openai, hume, cartesia)",
      "elevenlabs"
    )
```

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/VoiceCommands.ts
git commit -m "docs: mention hume and cartesia in voice command help text"
```

---

### Task 6: Document the new environment variables

**Files:**
- Modify: `README.md` (find the section listing required/optional environment variables; if none exists, add one near existing provider setup instructions)

- [ ] **Step 1: Check current README for env var documentation**

Run: `grep -n "ELEVENLABS_API_KEY\|OPENAI_API_KEY" README.md`

- [ ] **Step 2: Add `HUME_API_KEY` and `CARTESIA_API_KEY`**

Add them alongside the existing `ELEVENLABS_API_KEY` entry, following whatever format that section already uses (table, list, or `.env` example). Keep wording consistent with existing entries, e.g.:
```
- `HUME_API_KEY` — required to use the Hume voice provider
- `CARTESIA_API_KEY` — required to use the Cartesia voice provider
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document HUME_API_KEY and CARTESIA_API_KEY env vars"
```

---

### Task 7: Manual smoke test (requires real API keys)

This step is manual and requires valid `HUME_API_KEY` / `CARTESIA_API_KEY` values in `.env`. If keys aren't available, note that in the final report — this task is a should-do verification, not a blocker for the code to be merged, but it must not be silently skipped without saying so.

**Files:** none (verification only)

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 2: List voices from each new provider**

Run: `node dist/index.js voice import -p hume`
Expected: either imports N voices successfully, or fails with a clear error — if it fails, compare the actual response shape against `HumeProvider.getVoices()` and fix field names.

Run: `node dist/index.js voice import -p cartesia`
Expected: same as above for Cartesia.

- [ ] **Step 3: Synthesize one utterance per provider**

Using a voice ID imported in Step 2, use whatever CLI command exercises `IVocalProvider.tts()` in this codebase (check `SpeakerCommands.ts` / `SpeakerService.ts` for the actual invocation path) to synthesize a short test line through both `hume` and `cartesia` voices. Confirm an audio file is written to `appConfig.audioDir` and is playable.

- [ ] **Step 4: Fix any field-name mismatches found**

If Steps 2–3 reveal that Hume's or Cartesia's actual response shape differs from what `HumeProvider`/`CartesiaProvider` assume, fix the provider file(s), rebuild, and re-run the failing step until it passes.

- [ ] **Step 5: Commit any fixes**

```bash
git add src/providers/HumeProvider.ts src/providers/CartesiaProvider.ts
git commit -m "fix: correct Hume/Cartesia response field mapping based on live smoke test"
```
(Skip this commit if no fixes were needed.)

---

## Done criteria

- `npm run build` passes with no errors.
- `VocalProviderFactory.getProvider(VocalProviderName.Hume)` and `.getProvider(VocalProviderName.Cartesia)` return working provider instances instead of throwing "not implemented".
- Both providers implement emotional-expressiveness controls per the spec: Hume via `settings.instructions` → `description`, Cartesia via `settings.providerOptions.emotion`.
- Manual smoke test (Task 7) has been run, or its absence has been explicitly reported.
