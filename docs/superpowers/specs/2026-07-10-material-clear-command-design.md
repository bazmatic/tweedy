# Design: `tweedy material clear` command

## Problem

Ingested podcast source material accumulates in `data/materials/*.json` (via
`MaterialRepository`) with no way to bulk-remove it. Today the only deletion
path is `tweedy material delete <id>`, one record at a time. After a podcast
is finished, the user wants a single command to wipe all ingested material
records so the store doesn't build up cruft between projects.

## Scope

- Clears only `data/materials/*.json` (the `MaterialRecord` store managed by
  `MaterialRepository`).
- Does **not** touch the repo-root `material/` scratch/staging folder — that
  is a manual staging area outside the material pipeline and is explicitly
  out of scope.
- Does **not** touch the vector store/embeddings. `LangChainVectorStore`
  does not currently persist to disk (its `persistStore`/`loadStore` methods
  are no-op stubs; the store is rebuilt in-memory each CLI invocation), so
  there is nothing durable to clear there. This is a pre-existing gap,
  unrelated to this feature.

## Command

New subcommand under the existing `material` command group in
`src/cli/commands/MaterialCommands.ts`:

```
tweedy material clear [-y|--yes]
```

Behavior:
1. Fetch all materials via `materialService.getAllMaterials()`.
2. If empty, log `No materials to clear.` and exit.
3. If `--yes` not passed, prompt via `inquirer`:
   `Delete N materials? This cannot be undone. (y/N)`. Abort (no changes,
   log "Cancelled.") if the user declines.
4. On confirmation (or `--yes`), delete all materials and log
   `Cleared N materials.`

## Implementation layers

Following the existing repository/service/CLI layering used by
`add`/`delete`/`list`:

- **`IMaterialRepository` / `MaterialRepository`** (`src/repositories/MaterialRepository.ts`):
  add `deleteAll(): Promise<number>` — iterates `getAll()` and removes each
  record's JSON file via the existing `deleteRecord` primitive from
  `BaseRepository`, returning the count deleted.
- **`IMaterialService` / `MaterialService`**: add `clearAllMaterials(): Promise<number>`
  that delegates to `materialRepository.deleteAll()`.
- **CLI**: `material clear` command in `MaterialCommands.ts` wires the
  `inquirer` confirmation prompt and calls `materialService.clearAllMaterials()`.

## Error handling

Follows existing command conventions in `MaterialCommands.ts`: wrap in
try/catch, log via `logger.error` on failure, no process exit code changes.

## Testing

- Unit test for `MaterialRepository.deleteAll()`: seeds N fake records,
  calls `deleteAll()`, asserts the collection directory is empty and the
  count returned matches N.
- Unit test for `MaterialService.clearAllMaterials()` delegates correctly.
- No CLI-level test planned (matches existing coverage level for
  `MaterialCommands.ts`, which has no CLI-level tests today).
