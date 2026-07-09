# Speaker Slug — Design & Implementation Plan

## Goal
Give speakers a human-friendly identifier (`name-provider`, e.g. `alex-elevenlabs`) so users
can recognize and reuse good speaker configs without copying UUIDs.

## Design decisions
- Slug format: `slugify(name)-provider` (lowercase, non-alphanumeric → `-`).
- Computed once at creation from the speaker's `name` and the `provider` of its `voiceId`.
- Collisions resolved by appending `-2`, `-3`, ... at creation time.
- **Frozen after creation** — renaming a speaker or changing its voice does NOT regenerate
  the slug. It only changes via an explicit `--slug` update.
- Usable as an input: `script generate -s` accepts a mix of slugs and UUIDs.

## Implementation steps

### 1. Types — `src/types/index.ts`
- Add `slug: string` to `Speaker` (near `name`, line ~65) and `SpeakerRecord` (near `name`, line ~140).

### 2. Repository — `src/repositories/SpeakerRepository.ts`
- Add a private `slugify(input: string): string` helper: lowercase, replace non-alphanumeric
  runs with `-`, trim leading/trailing `-`.
- Add `private async generateSlug(name: string, provider: string, excludeId?: string): Promise<string>`:
  - base = `${slugify(name)}-${provider}`
  - fetch `getAll()`, filter out `excludeId` if given, collect existing slugs
  - if base is free, return it; else try `${base}-2`, `${base}-3`, ... until free
- `create(speaker)`: signature changes to accept `provider` alongside the existing fields
  (simplest: have the caller—`SpeakerService`—pass `slug` already computed, OR pass `provider`
  through and compute here). **Chosen approach:** `SpeakerService.createSpeaker` looks up the
  voice's provider first and calls `speakerRepository.create({ ...speaker, slug: <computed> })`
  is awkward because slug generation (collision check) belongs in the repo. Instead:
  - Change `create()` to take the full `Omit<SpeakerRecord, "id"|"createdAt"|"updatedAt"|"slug">`
    plus a `provider: VocalProviderName` param, compute the slug internally via `generateSlug`,
    and store it on the record.
- Add `async findBySlug(slug: string): Promise<SpeakerRecord | null>` (same pattern as `findByName`).
- `update()`: unchanged behavior for slug (frozen) — but if the partial update includes an explicit
  `slug`, validate it's unique (excluding this record's own id) via `generateSlug`-style check
  before saving; if the requested slug collides with a *different* record, throw an error
  (do not silently suffix — this is a deliberate user action, so surface the conflict).

### 3. Types — `ISpeakerRepository` (`src/types/index.ts`)
- Update `create()` signature to include the new `provider` param.
- Add `findBySlug(slug: string): Promise<SpeakerRecord | null>`.

### 4. Service — `src/services/SpeakerService.ts`
- `createSpeaker`: fetch `voiceRepository.getById(speaker.voiceId)` first (needed for provider
  anyway), throw if missing, then call `speakerRepository.create(speaker, voiceRecord.provider)`.
- `updateSpeaker`: if `speaker.slug` is present in the partial, pass through as-is; repository
  validates uniqueness (per step 2).
- Add `getSpeakerBySlug(slug: string): Promise<Speaker>` — mirrors `getSpeaker(id)` but uses
  `speakerRepository.findBySlug`.
- `populateSpeakerWithVoice`: include `slug: record.slug` in the returned `Speaker`.

### 5. Types — `ISpeakerService` (`src/types/index.ts`)
- Add `getSpeakerBySlug(slug: string): Promise<Speaker>`.

### 6. CLI — `src/cli/commands/SpeakerCommands.ts`
- `list`: change output line to
  `  [${speaker.slug}] ${speaker.name} (${speaker.voice.name}) - ${speaker.personality}`
  and demote id to the detail lines below (`    ID: ${speaker.id}`).
- `add`: success message → `` `Speaker created: ${speaker.slug}` ``.
- `update <id>`: add `.option("--slug <slug>", "New speaker slug (must be unique)")`, wire into
  `updateData.slug`.

### 7. Script generation resolution — `src/services/ScriptService.ts`
- `loadSpeakers`: for each `config.id` token, first try `speakerRepository.findBySlug(config.id)`;
  if null, fall back to `speakerRepository.getById(config.id)`; if still null, throw
  `` `Speaker '${config.id}' not found (tried as slug and id)` ``.
- No signature changes needed — `GenerateScriptParams.speakers` already carries opaque `{id}`
  strings; we're just making the resolution polymorphic over slug-or-uuid.

### 8. CLI — `src/cli/commands/ScriptCommands.ts`
- No change required to option parsing (`-s/--speakers` already splits comma-separated tokens
  into `{id}` objects) — the polymorphic resolution lives in `ScriptService.loadSpeakers`.
- Update the `--speakers` option help text to mention slugs are accepted.

## Manual verification (no test suite present for these paths — verify via CLI)
1. `tweedy speaker add -n Alex -p "dry wit" -v <voiceId>` → confirm output shows slug
   `alex-<provider>`.
2. Create a second speaker with the same name + same provider → confirm slug gets `-2` suffix.
3. `tweedy speaker list` → confirm slug displayed, id demoted.
4. `tweedy speaker update <id> --slug custom-name` → confirm it updates; repeat with a slug
   already used by another speaker → confirm it's rejected with a clear error.
5. `tweedy speaker update <id> -n NewName` → confirm slug is unchanged.
6. `tweedy script generate -s alex-elevenlabs,<other-speaker-uuid> ...` → confirm both resolve
   correctly.
