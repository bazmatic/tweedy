# Design: Hume and Cartesia Voice Providers

## Goal

Make the podcast tool's voice synthesis provider-agnostic in practice, not just in shape. `IVocalProvider`, `BaseVocalProvider`, and `VocalProviderFactory` already exist and support ElevenLabs and OpenAI. Hume is currently stubbed to throw. This spec adds working `HumeProvider` and `CartesiaProvider` implementations, and preserves each provider's ability to control emotional expressiveness and realism.

## Non-goals

- No change to the `IVocalProvider` interface shape (`tts`, `getVoices`).
- No per-provider strongly-typed settings union — a generic passthrough is enough.
- No streaming audio support (SSE/WebSocket) for either provider, even though both APIs offer it. Non-streaming (`/tts` and `/tts/bytes`) matches the existing synchronous file-write pattern used by ElevenLabs/OpenAI.
- No retrofitting of ElevenLabsProvider/OpenAIProvider.
- No CLI changes — `VoiceCommands`/`SpeakerCommands` already operate generically over `VocalProviderName`.

## Changes

### 1. `VocalProviderName` enum (`src/types/index.ts`)

Add:
```ts
Cartesia = "cartesia"
```
(`Hume` already exists.)

### 2. `VoiceSettings` (`src/types/index.ts`)

Add one new optional field:
```ts
providerOptions?: Record<string, unknown>;
```
Rationale: `stability`, `similarityBoost`, `style`, `instructions` stay as the shared/common fields. Provider-specific knobs that don't generalize (Cartesia's discrete emotion tag, volume) go in `providerOptions`. This keeps `Voice`/`VoiceSettings` a stable shape all providers can read without every provider needing new top-level fields.

### 3. `HumeProvider` (`src/providers/HumeProvider.ts`)

Extends `BaseVocalProvider`, follows the `ElevenLabsProvider` structure.

- Constructor reads `HUME_API_KEY` from env; throws if missing (matches existing pattern).
- `tts()`:
  - `POST https://api.hume.ai/v0/tts`
  - Header: `X-Hume-Api-Key: <key>`
  - Body:
    ```json
    {
      "utterances": [{
        "text": "<speech.message>",
        "voice": { "id": "<voice.providerId>" },
        "description": "<voice.settings.instructions>",
        "speed": "<voice.settings.providerOptions?.speed>"
      }]
    }
    ```
    `description` is Hume's emotional/acting-direction field (free text, e.g. "patient, empathetic counsellor") — mapped from the existing `instructions` field, so no new shared field is needed.
  - Response is JSON with base64-encoded audio; decode with `Buffer.from(data, 'base64')` and write to `appConfig.audioDir` (same as other providers).
- `getVoices()`: calls Hume's voice-list endpoint, maps to `Voice[]` with `provider: VocalProviderName.Hume`.

### 4. `CartesiaProvider` (`src/providers/CartesiaProvider.ts`)

Extends `BaseVocalProvider`.

- Constructor reads `CARTESIA_API_KEY` from env; throws if missing.
- A module-level constant `CARTESIA_API_VERSION` (dated string, e.g. `'2026-03-01'`) sent as the `Cartesia-Version` header — pinned rather than inferred, so behavior doesn't silently shift when Cartesia ships a new default.
- `tts()`:
  - `POST https://api.cartesia.ai/tts/bytes`
  - Headers: `Authorization: Bearer <key>`, `Cartesia-Version: <CARTESIA_API_VERSION>`
  - Body:
    ```json
    {
      "model_id": "sonic-3",
      "transcript": "<speech.message>",
      "voice": { "mode": "id", "id": "<voice.providerId>" },
      "output_format": { "container": "mp3", "sample_rate": 44100 },
      "generation_config": {
        "emotion": "<voice.settings.providerOptions?.emotion>",
        "speed": "<voice.settings.providerOptions?.speed>",
        "volume": "<voice.settings.providerOptions?.volume>"
      }
    }
    ```
    `emotion` is Cartesia's discrete named-emotion control (~54 options e.g. `angry`, `calm`, `sad`); it and `volume` have no equivalent shared field, so both live under `providerOptions`. `speed` also goes under `providerOptions` for consistency with Hume's `speed`, rather than mapping to a shared field, since only these two providers have it.
  - Response is raw binary audio — write directly to `appConfig.audioDir`, no decoding step.
- `getVoices()`: calls `GET /voices`, maps to `Voice[]` with `provider: VocalProviderName.Cartesia`.

### 5. `VocalProviderFactory` (`src/providers/VocalProviderFactory.ts`)

- Replace the `Hume` case's `throw` with `new HumeProvider()`.
- Add a `Cartesia` case returning `new CartesiaProvider()`.

### 6. `src/providers/index.ts`

Export `HumeProvider` and `CartesiaProvider` alongside the existing exports.

## Error handling

Both new providers follow the existing pattern exactly: missing API key throws at construction time (not at `tts()` call time), so `VocalProviderFactory.getAvailableProviders()` naturally excludes unconfigured providers without special-casing. `tts()`/`getVoices()` wrap requests in try/catch using the inherited `logTtsError`/`logger.error`, matching `ElevenLabsProvider`/`OpenAIProvider`.

## Open items to verify during implementation (not blocking)

- Hume's exact HTTP method per endpoint was inferred as POST from doc structure, not explicitly confirmed live.
- Whether Cartesia still accepts an `X-API-Key` header alongside `Authorization: Bearer` wasn't independently confirmed — implementation should use Bearer as the documented current approach.
- Both should get a smoke test against a real account (a manual `voice:list` and one `tts` call per provider) before being considered done, per the project's existing manual-testing pattern for providers.

## Testing

- Unit tests for `HumeProvider`/`CartesiaProvider` mocking `axios`/`fetch`, covering: successful `tts()` writes expected file, `getVoices()` maps response fields correctly, missing API key throws at construction.
- Extend `VocalProviderFactory` tests (if present) to cover the new `Cartesia` case and the un-stubbed `Hume` case.
