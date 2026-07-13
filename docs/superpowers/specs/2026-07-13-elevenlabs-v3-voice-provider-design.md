# Design: ElevenLabsV3 Voice Provider

## Goal

Add an `ElevenLabsV3Provider` so speakers can opt into ElevenLabs' `eleven_v3` model for improved quality/expressiveness, as a separate provider alongside the existing `ElevenLabsProvider` (which stays on `eleven_multilingual_v2`). Users choose per-voice which model renders it by setting `provider: VocalProviderName.ElevenLabsV3` instead of `ElevenLabs`.

## Non-goals

- No change to the `IVocalProvider` interface shape (`tts`, `getVoices`).
- No support for v3's audio/emotion tags (e.g. `[excited]`, `[whispers]`) in speech text — out of scope for this pass.
- No new shared `VoiceSettings` fields — the v3-specific stability preset goes through the existing `providerOptions` escape hatch.
- No independent API key — `ElevenLabsV3Provider` reuses `ELEVENLABS_API_KEY`.
- No separate voice catalog — v3 draws from the same ElevenLabs voice library as v1/v2.

## Changes

### 1. `VocalProviderName` enum (`src/types/index.ts`)

Add:
```ts
ElevenLabsV3 = "elevenlabs_v3"
```

### 2. `ElevenLabsProvider` (`src/providers/ElevenLabsProvider.ts`)

Loosen `apiKey` and `baseUrl` from `private` to `protected` so `ElevenLabsV3Provider` can reuse them via subclassing.

### 3. `ElevenLabsV3Provider` (`src/providers/ElevenLabsV3Provider.ts`)

Extends `ElevenLabsProvider` (not `BaseVocalProvider` directly) to reuse `getVoices()` and the API key/constructor as-is. Overrides:

- `getProviderName()` → `'ElevenLabsV3'`.
- `tts()`:
  - Validates params, logs the request (inherited helpers).
  - Reads `providerOptions.stabilityPreset` off `params.voice.settings` — one of `'creative' | 'natural' | 'robust'`, mapped to `0.0 / 0.5 / 1.0`. Defaults to `'creative'` (0.0) when unset.
  - `POST ${baseUrl}/text-to-speech/${params.voice.providerId}` with body:
    ```ts
    {
      text: params.speech.message,
      model_id: 'eleven_v3',
      voice_settings: {
        stability: stabilityValue, // 0.0 | 0.5 | 1.0
        use_speaker_boost: true,
      },
    }
    ```
  - No `seed`, `previous_text`/`next_text`, or `speed` — v3 does not support these, so they're omitted entirely rather than sent and ignored.
  - `responseType: 'arraybuffer'`, written via `fs.writeFile` to `path.join(appConfig.audioDir, params.outputFileName)` after `fs.ensureDir`, matching `ElevenLabsProvider`.
  - Wrapped in try/catch using inherited `logTtsError`.
- `getVoices()`: not overridden — inherits `ElevenLabsProvider.getVoices()` directly, so imported voices are tagged `provider: VocalProviderName.ElevenLabs` by that method. Callers importing specifically for v3 use will need to set `provider: VocalProviderName.ElevenLabsV3` themselves via `voice add` (see `VoiceCommands.ts`), same as any manually-added voice.

### 4. `VocalProviderFactory` (`src/providers/VocalProviderFactory.ts`)

Add `case VocalProviderName.ElevenLabsV3: this.providers.set(provider, new ElevenLabsV3Provider()); break;`.

### 5. `src/providers/index.ts`

Export `ElevenLabsV3Provider` alongside the existing exports.

### 6. `VoiceCommands.ts` CLI help text

Add `elevenlabs_v3` to the `--provider` option's description string listing valid providers.

## Error handling

Same as every provider: `tts()` wraps requests in try/catch using inherited `logTtsError`/`logger.error`. Missing `ELEVENLABS_API_KEY` throws at construction time (inherited from `ElevenLabsProvider`'s constructor), which `VocalProviderFactory.getAvailableProviders()` catches and treats as "unavailable."

## Open items to verify during implementation (not blocking)

- The v3 `voice_settings` shape (`stability` + `use_speaker_boost` only, no `similarity_boost`/`style`) and the omission of `seed`/`previous_text`/`next_text`/`speed` are based on current understanding of the v3 alpha API, not independently confirmed against a live call. Flag this with a code comment in `ElevenLabsV3Provider.tts()` and verify/adjust once tested against the real endpoint.

## Testing

- Unit test `ElevenLabsV3Provider.test.ts` mocking `axios`, following `ElevenLabsProvider.test.ts` conventions (if one exists) or `GrokProvider.test.ts`/`KokoroProvider.test.ts` otherwise: asserts the request body has `model_id: 'eleven_v3'`, correct stability mapping for each of the three presets, defaulting to `'creative'` (0.0) when `stabilityPreset` is unset, and confirms `getVoices()` delegates to the parent class.
- Extend `VocalProviderFactory` tests (if present) to cover the new `ElevenLabsV3` case.
