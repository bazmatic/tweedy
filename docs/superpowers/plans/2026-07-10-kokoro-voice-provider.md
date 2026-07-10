# Kokoro Voice Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `KokoroProvider` implementing `IVocalProvider` so the podcast tool can synthesize speech via a locally running Kokoro TTS server, alongside the existing ElevenLabs/OpenAI/Hume/Cartesia providers.

**Architecture:** `KokoroProvider` extends `BaseVocalProvider` and reuses the `openai` npm SDK client (already a dependency, used by `OpenAIProvider`) pointed at a local `baseURL`, because Kokoro's `kokoro-fastapi` server exposes a speech-generation endpoint compatible with OpenAI's `/v1/audio/speech`. The voice list is fetched live from the server's `/v1/audio/voices` endpoint via the global `fetch` (Node >=18, already the package's engine floor) rather than through the SDK, since the SDK has no typed helper for that endpoint.

**Tech Stack:** TypeScript, `openai` SDK v5, `fs-extra`, `vitest` (with `vi.mock`/`vi.stubGlobal` — no other mocking library is installed).

## Global Constraints

- No changes to the `IVocalProvider` interface shape (`tts`, `getVoices`).
- No new shared `VoiceSettings` fields — Kokoro-specific knobs go through the existing `settings.providerOptions` passthrough.
- `KokoroProvider`'s constructor must NOT throw when `KOKORO_BASE_URL` is unset — default to `http://localhost:8880/v1`. This is the one behavior that diverges from every other provider (which throw on a missing API key).
- No container/process lifecycle management (starting/stopping the Kokoro server) — the provider assumes a server is already reachable.
- No streaming audio support.

---

### Task 1: `KokoroProvider` — enum, implementation, and unit tests

**Files:**
- Modify: `src/types/index.ts` (add `Kokoro = "kokoro"` to the `VocalProviderName` enum)
- Create: `src/providers/KokoroProvider.ts`
- Test: `src/providers/KokoroProvider.test.ts`

**Interfaces:**
- Consumes: `BaseVocalProvider` (`src/providers/BaseVocalProvider.ts`) — `validateParams(params)`, `logTtsRequest(params)`, `logTtsSuccess(outputFile: string)`, `logTtsError(error: any)`. `appConfig.audioDir: string` from `src/utils/config.ts`. `VocalProviderTtsParams`, `Voice`, `VocalProviderName` from `src/types`.
- Produces: `KokoroProvider` class with `tts(params: VocalProviderTtsParams): Promise<string>` and `getVoices(): Promise<Voice[]>`, matching `IVocalProvider`. Later tasks (Task 2) import this class by name from `./KokoroProvider`.

- [ ] **Step 1: Add `Kokoro` to the `VocalProviderName` enum**

In `src/types/index.ts`, change:

```ts
export enum VocalProviderName {
  ElevenLabs = "elevenlabs",
  OpenAI = "openai",
  Hume = "hume",
  Cartesia = "cartesia",
}
```

to:

```ts
export enum VocalProviderName {
  ElevenLabs = "elevenlabs",
  OpenAI = "openai",
  Hume = "hume",
  Cartesia = "cartesia",
  Kokoro = "kokoro",
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/providers/KokoroProvider.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreate = vi.fn();

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    audio: { speech: { create: mockCreate } },
  })),
}));

vi.mock('fs-extra', () => ({
  ensureDir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

import * as fs from 'fs-extra';
import { KokoroProvider } from './KokoroProvider';
import { VocalProviderName } from '../types';
import type { Speaker, Speech, Voice } from '../types';

function buildVoice(overrides: Partial<Voice> = {}): Voice {
  return {
    id: 'af_heart',
    name: 'af_heart',
    description: 'af_heart',
    provider: VocalProviderName.Kokoro,
    providerId: 'af_heart',
    settings: {},
    ...overrides,
  };
}

function buildSpeech(voice: Voice): Speech {
  const speaker: Speaker = {
    id: 'speaker-1',
    name: 'Test Speaker',
    personality: 'curious',
    voice,
    voiceStyle: 'neutral',
    isExpert: false,
  };
  return {
    id: 'speech-1',
    speaker,
    message: 'Hello from Kokoro',
    instructions: '',
    voice,
    voiceStyle: 'neutral',
    timestamp: new Date(),
  };
}

describe('KokoroProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.KOKORO_BASE_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('constructs successfully with no environment variables set', () => {
    expect(() => new KokoroProvider()).not.toThrow();
  });

  it('writes synthesized audio to the configured output path', async () => {
    mockCreate.mockResolvedValue({
      arrayBuffer: async () => new TextEncoder().encode('fake-audio-bytes').buffer,
    });

    const provider = new KokoroProvider();
    const voice = buildVoice();
    const outputPath = await provider.tts({
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
    expect(fs.writeFile).toHaveBeenCalledWith(outputPath, expect.any(Buffer));
    expect(outputPath.endsWith('output.mp3')).toBe(true);
  });

  it('spreads providerOptions into the request body', async () => {
    mockCreate.mockResolvedValue({
      arrayBuffer: async () => new TextEncoder().encode('fake-audio-bytes').buffer,
    });

    const provider = new KokoroProvider();
    const voice = buildVoice({ settings: { providerOptions: { speed: 1.2 } } });
    await provider.tts({
      speech: buildSpeech(voice),
      voice,
      outputFileName: 'output.mp3',
    });

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ speed: 1.2 }));
  });

  it('maps the server voice list into the shared Voice shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ voices: ['af_heart', 'am_michael'] }),
      })
    );

    const provider = new KokoroProvider();
    const voices = await provider.getVoices();

    expect(voices).toEqual([
      {
        id: 'af_heart',
        name: 'af_heart',
        description: 'af_heart',
        provider: VocalProviderName.Kokoro,
        providerId: 'af_heart',
        settings: {},
      },
      {
        id: 'am_michael',
        name: 'am_michael',
        description: 'am_michael',
        provider: VocalProviderName.Kokoro,
        providerId: 'am_michael',
        settings: {},
      },
    ]);
  });

  it('throws when the voices endpoint responds with an error status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      })
    );

    const provider = new KokoroProvider();
    await expect(provider.getVoices()).rejects.toThrow('503');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/providers/KokoroProvider.test.ts`
Expected: FAIL — `Cannot find module './KokoroProvider'` (the file doesn't exist yet).

- [ ] **Step 4: Implement `KokoroProvider`**

Create `src/providers/KokoroProvider.ts`:

```ts
import OpenAI from 'openai';
import * as fs from 'fs-extra';
import * as path from 'path';
import { BaseVocalProvider } from './BaseVocalProvider';
import { VocalProviderTtsParams, Voice, VocalProviderName } from '../types';
import { appConfig } from '../utils/config';

export class KokoroProvider extends BaseVocalProvider {
  private client: OpenAI;
  private baseUrl: string;

  constructor() {
    super();
    this.baseUrl = process.env.KOKORO_BASE_URL || 'http://localhost:8880/v1';
    this.client = new OpenAI({ apiKey: 'not-needed', baseURL: this.baseUrl });
  }

  protected getProviderName(): string {
    return 'Kokoro';
  }

  async tts(params: VocalProviderTtsParams): Promise<string> {
    this.validateParams(params);
    this.logTtsRequest(params);

    try {
      const outputPath = path.join(appConfig.audioDir, params.outputFileName);
      await fs.ensureDir(path.dirname(outputPath));

      const response = await this.client.audio.speech.create({
        model: 'kokoro',
        voice: params.voice.providerId as any,
        input: params.speech.message,
        response_format: 'mp3',
        ...(params.voice.settings.providerOptions || {}),
      } as any);

      const buffer = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(outputPath, buffer);

      this.logTtsSuccess(outputPath);
      return outputPath;
    } catch (error) {
      this.logTtsError(error);
      throw error;
    }
  }

  async getVoices(): Promise<Voice[]> {
    const response = await fetch(`${this.baseUrl}/audio/voices`);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch Kokoro voices: ${response.status} ${response.statusText}`
      );
    }
    const data = (await response.json()) as { voices: string[] };

    return data.voices.map((name) => ({
      id: name,
      name,
      description: name,
      provider: VocalProviderName.Kokoro,
      providerId: name,
      settings: {},
    }));
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/providers/KokoroProvider.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/providers/KokoroProvider.ts src/providers/KokoroProvider.test.ts
git commit -m "feat: add KokoroProvider for local Kokoro TTS server"
```

---

### Task 2: Wire `KokoroProvider` into the factory and exports

**Files:**
- Modify: `src/providers/VocalProviderFactory.ts`
- Modify: `src/providers/index.ts`

**Interfaces:**
- Consumes: `KokoroProvider` from `./KokoroProvider` (produced in Task 1). `VocalProviderName.Kokoro` from `../types` (added in Task 1).
- Produces: `VocalProviderFactory.getProvider(VocalProviderName.Kokoro)` returns a working `KokoroProvider` instance; `VocalProviderFactory.getAvailableProviders()` includes `VocalProviderName.Kokoro` whenever a Kokoro server is reachable. `KokoroProvider` is importable from `src/providers/index.ts`.

- [ ] **Step 1: Add the `Kokoro` case to `VocalProviderFactory`**

In `src/providers/VocalProviderFactory.ts`, add the import:

```ts
import { KokoroProvider } from './KokoroProvider';
```

and add a case to the switch inside `getProvider`:

```ts
        case VocalProviderName.Cartesia:
          this.providers.set(provider, new CartesiaProvider());
          break;
        case VocalProviderName.Kokoro:
          this.providers.set(provider, new KokoroProvider());
          break;
        default:
          throw new Error(`Unknown vocal provider: ${provider}`);
```

- [ ] **Step 2: Export `KokoroProvider` from the providers barrel**

In `src/providers/index.ts`, add:

```ts
export { KokoroProvider } from './KokoroProvider';
```

so the full file reads:

```ts
export { BaseVocalProvider } from './BaseVocalProvider';
export { ElevenLabsProvider } from './ElevenLabsProvider';
export { OpenAIProvider } from './OpenAIProvider';
export { HumeProvider } from './HumeProvider';
export { CartesiaProvider } from './CartesiaProvider';
export { KokoroProvider } from './KokoroProvider';
export { VocalProviderFactory } from './VocalProviderFactory';
export { AudioProcessor } from './AudioProcessor';
export { AiModelFactory } from './AiModelFactory';
```

(`AiModelFactory` was added by an unrelated AI-provider refactor that landed after this plan was written — keep its export line, just insert `KokoroProvider` above `VocalProviderFactory` alongside the other vocal providers.)

- [ ] **Step 3: Typecheck and run the full test suite**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx vitest run`
Expected: all tests pass, including the 5 new `KokoroProvider` tests.

- [ ] **Step 4: Commit**

```bash
git add src/providers/VocalProviderFactory.ts src/providers/index.ts
git commit -m "feat: register KokoroProvider in the vocal provider factory"
```

---

## Manual smoke test (post-implementation, not automated)

Requires a running Kokoro server:

```bash
podman run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu
```

Then, with `DEFAULT_VOICE_PROVIDER=kokoro` set (or by calling `VocalProviderFactory.getProvider(VocalProviderName.Kokoro)` directly from a script), run the project's existing `voice:list` command and one `tts` call to confirm:
- `getVoices()` returns the real voice list from the running container (confirms the assumed `/v1/audio/voices` response shape of `{ voices: string[] }` — adjust the mapping in `KokoroProvider.getVoices()` if the live shape differs).
- `tts()` produces a playable MP3 file in `appConfig.audioDir`.
