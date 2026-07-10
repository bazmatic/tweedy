# Design: Grok Voice Provider

## Goal

Add a `GrokProvider` so the podcast tool can synthesize speech with xAI's Grok TTS API (https://docs.x.ai/developers/model-capabilities/audio/text-to-speech), alongside the existing cloud providers (ElevenLabs, OpenAI, Hume, Cartesia, Kokoro). Grok's API is a plain REST endpoint (`POST https://api.x.ai/v1/tts`), **not** OpenAI-compatible, so `GrokProvider` follows the `CartesiaProvider` structure (raw `axios` calls) rather than `OpenAIProvider`'s SDK-based one.

## Non-goals

- No change to the `IVocalProvider` interface shape (`tts`, `getVoices`).
- No new shared `VoiceSettings` fields — Grok-specific knobs (`speed`, `language`) go through the existing `providerOptions` escape hatch.
- No WebSocket/streaming TTS support (`wss://api.x.ai/v1/tts`) — matches the existing synchronous file-write pattern used by all other providers.
- No support for `with_timestamps` (character-level timing) or the Custom Voices (cloning) API.
- No CLI changes — `VoiceCommands`/`SpeakerCommands` already operate generically over `VocalProviderName`.

## Changes

### 1. `VocalProviderName` enum (`src/types/index.ts`)

Add:
```ts
Grok = "grok"
```

### 2. `GrokProvider` (`src/providers/GrokProvider.ts`)

Extends `BaseVocalProvider`, follows the `CartesiaProvider` structure (axios, bearer auth header, arraybuffer response).

- Constructor reads `XAI_API_KEY` from env, throws if missing (matches every provider except Kokoro).
- `private baseUrl = 'https://api.x.ai/v1'` and a `headers` getter returning `{ Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' }`.
- `tts()`:
  - Validates params, logs the request (inherited helpers).
  - Reads `providerOptions` off `params.voice.settings` for `speed` and `language`.
  - `POST ${baseUrl}/tts` with body:
    ```ts
    {
      text: params.speech.message,
      voice_id: params.voice.providerId,
      language: options.language ?? 'auto',
      output_format: { container: 'mp3', sample_rate: 24000 },
      ...(options.speed !== undefined ? { speed: options.speed } : {}),
    }
    ```
  - `responseType: 'arraybuffer'`, written via `fs.writeFile` to `path.join(appConfig.audioDir, params.outputFileName)` after `fs.ensureDir`, matching every other provider.
  - Wrapped in try/catch using inherited `logTtsError`.
- `getVoices()`:
  - `GET ${baseUrl}/tts/voices` (per your answer — fetch dynamically rather than hardcoding the 5 built-in voices, so cloned/custom voices on the account show up too).
  - Maps each returned voice into the shared shape: `{ id: voice.id, name: voice.name, description: voice.description || voice.name, provider: VocalProviderName.Grok, providerId: voice.id, settings: {} }`, mirroring `CartesiaProvider.getVoices()`'s `response.data.data ?? response.data` unwrap in case the endpoint nests results.

### 3. `VocalProviderFactory` (`src/providers/VocalProviderFactory.ts`)

Add `case VocalProviderName.Grok: this.providers.set(provider, new GrokProvider()); break;`.

### 4. `src/providers/index.ts`

Export `GrokProvider` alongside the existing exports.

### 5. `env.example`

Add `XAI_API_KEY=` alongside the other optional provider keys.

## Error handling

Same as every provider: `tts()`/`getVoices()` wrap requests in try/catch using inherited `logTtsError`/`logger.error`. A missing `XAI_API_KEY` throws at construction time, which `VocalProviderFactory.getAvailableProviders()` catches and treats as "unavailable," consistent with ElevenLabs/OpenAI/Hume/Cartesia.

## Open items to verify during implementation (not blocking)

- Exact shape of the `GET /v1/tts/voices` response (field names for id/name/description) — inferred from the docs summary, not independently confirmed against a live call.
- Whether `output_format.sample_rate: 24000` is accepted alongside `container: 'mp3'` (docs list both as configurable but don't show a combined example) — 24000 is chosen to match the default described for plain MP3 responses.

## Testing

- Unit test `GrokProvider.test.ts` mocking `axios`, following `PerplexityProvider.test.ts`/`KokoroProvider.test.ts` conventions: successful `tts()` posts the expected body and writes the file, `getVoices()` maps the response correctly, construction throws without `XAI_API_KEY`.
- Extend `VocalProviderFactory` tests (if present) to cover the new `Grok` case.
