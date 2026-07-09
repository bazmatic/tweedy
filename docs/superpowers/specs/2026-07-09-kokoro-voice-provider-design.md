# Design: Kokoro Voice Provider

## Goal

Add a `KokoroProvider` so the podcast tool can synthesize speech with [Kokoro](https://ariya.io/2026/03/local-cpu-friendly-high-quality-tts-text-to-speech-with-kokoro/), a local, CPU-friendly TTS model, alongside the existing cloud providers (ElevenLabs, OpenAI, Hume, Cartesia). Kokoro runs locally via the `kokoro-fastapi` container (`podman run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu`), which exposes a speech API compatible with OpenAI's `/v1/audio/speech` and `/v1/audio/voices` endpoints. This lets `KokoroProvider` reuse the `openai` SDK client already used by `OpenAIProvider`, pointed at a local `baseURL` instead of OpenAI's.

## Non-goals

- No change to the `IVocalProvider` interface shape (`tts`, `getVoices`).
- No new shared `VoiceSettings` fields — Kokoro-specific knobs (e.g. `speed`, `lang_code`) go through the existing `providerOptions` escape hatch.
- No management of the Kokoro container lifecycle (starting/stopping podman/docker) — the provider assumes a server is already running and reachable.
- No CLI changes — `VoiceCommands`/`SpeakerCommands` already operate generically over `VocalProviderName`.
- No streaming audio support — matches the existing synchronous file-write pattern used by all other providers.

## Changes

### 1. `VocalProviderName` enum (`src/types/index.ts`)

Add:
```ts
Kokoro = "kokoro"
```

### 2. `KokoroProvider` (`src/providers/KokoroProvider.ts`)

Extends `BaseVocalProvider`, follows the `OpenAIProvider` structure since both talk to an OpenAI-compatible speech API.

- Constructor reads `KOKORO_BASE_URL` from env, defaulting to `http://localhost:8880/v1` if unset. Unlike every other provider, it does **not** throw when config is absent — Kokoro has no API key requirement, so a missing env var just means "use the default local port." The `openai` SDK client is constructed with a placeholder `apiKey` (e.g. `'not-needed'`, since the SDK requires a non-empty string) and `baseURL: this.baseUrl`.
- `tts()`:
  - Calls `this.client.audio.speech.create({ model: 'kokoro', voice: params.voice.providerId, input: params.speech.message, response_format: 'mp3', ...params.voice.settings.providerOptions })`, mirroring `OpenAIProvider.tts()` exactly (validate params, log request, `fs.ensureDir`, write the returned array buffer to `path.join(appConfig.audioDir, params.outputFileName)`, log success, return the path).
  - Any Kokoro-specific generation params (e.g. `speed`) are spread from `params.voice.settings.providerOptions` into the request body, same escape-hatch pattern as Cartesia/Hume.
- `getVoices()`:
  - Fetches the live voice list from the server rather than hardcoding it, since Kokoro's voice set can change with the container image. Calls `GET ${this.baseUrl}/audio/voices` (via `this.client` if the SDK exposes a matching helper, otherwise a plain `fetch`/`axios` call against that URL).
  - Maps each returned voice name (e.g. `af_heart`, `am_michael`, `am_eric`) into the shared shape: `{ id: name, name, description: name, provider: VocalProviderName.Kokoro, providerId: name, settings: {} }`. Kokoro voice names are self-descriptive prefixes (`af_`/`am_` = American female/male, etc.) but there's no separate human-readable description field from the API, so `description` just mirrors `name`.

### 3. `VocalProviderFactory` (`src/providers/VocalProviderFactory.ts`)

Add a `case VocalProviderName.Kokoro: this.providers.set(provider, new KokoroProvider()); break;`.

### 4. `src/providers/index.ts`

Export `KokoroProvider` alongside the existing exports.

## Error handling

`tts()`/`getVoices()` wrap requests in try/catch using the inherited `logTtsError`/`logger.error`, matching every other provider. Because the constructor never throws for missing config, `VocalProviderFactory.getAvailableProviders()` will only mark Kokoro unavailable when `getVoices()` actually fails to reach a server (connection refused, timeout) — the natural signal that no local Kokoro container is running, with no special-casing needed in the factory.

## Open items to verify during implementation (not blocking)

- Whether Kokoro-FastAPI's voices endpoint is exactly `/v1/audio/voices` (OpenAI has no equivalent standard endpoint, so this is Kokoro-specific and inferred from its OpenAI-compatibility claim, not independently confirmed).
- Whether the `model` field in the speech request must be literally `"kokoro"` or is ignored by the server (some OpenAI-compatible local servers accept any value).
- A smoke test against a running `kokoro-fastapi` container (one `voice:list` and one `tts` call) before considering this done, per the project's existing manual-testing pattern for providers.

## Testing

- Unit test for `KokoroProvider` mocking the `openai` SDK client (or `fetch`/`axios` for the voices call), covering: successful `tts()` writes the expected file with the right request body, `getVoices()` maps server response fields correctly, construction succeeds with no env vars set (using the default base URL) — this is the one behavior that diverges from every existing provider test and is worth asserting explicitly.
- Extend `VocalProviderFactory` tests (if present) to cover the new `Kokoro` case.
