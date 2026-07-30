# Mastra runtime

Tweedy uses the typed Mastra episode workflow by default. Set
`CONVERSATION_WORKFLOW_ENGINE=legacy` or pass `--engine legacy` to
`tweedy script generate` for configuration-only rollback during the soak
window. See [MASTRA_CUTOVER.md](MASTRA_CUTOVER.md) for success thresholds,
monitoring and the rollback procedure.

## Pinned compatibility line

Tweedy requires Node 22.13+ and pins Mastra core 1.55.0 and LibSQL storage
1.18.0, matching the `mastra` CLI (1.21.0, used only for Studio). AI SDK
5.0.76 and its OpenAI 2.0.53 and Anthropic 2.0.33 providers are pinned from
the generation used when Mastra core was 0.23.3 and remain compatible with
1.55.0; reverify them if Mastra core is upgraded again. Upgrade these
packages together and rerun the full test suite. Do not use floating ranges.

`Workflow.createRunAsync` was renamed to `createRun` (still async) in the 1.x
line, and `LibSQLStore` now requires an `id` in its constructor config.
`LibSQLStore#loadWorkflowSnapshot` moved off the top-level store onto the
`workflows` storage domain: call `await storage.getStore("workflows")` first.

## Composition and storage

Call `createTweedyMastra()` from `src/mastra`. Importing the module has no
startup side effects: it does not run a workflow, start a server, or construct
an AI provider client. The default CLI paths are:

- workflow snapshots: `DATA_DIR/mastra.db`
- redacted traces: `DATA_DIR/mastra-traces.jsonl`

Override them with `MASTRA_STORAGE_PATH` and `MASTRA_TRACE_PATH`. The storage
directory must be writable. SQLite `-wal` and `-shm` companion files are
normal while a process is active.

## Model routing

Every `ModelTask` currently uses the `langchain-compatibility` route. That
route delegates to `AiModelFactory`, preserving the provider catalogue,
quality tier, model identifier, temperature, token budget, tool calls, and
structured-output behavior. Migrating a task to a native Mastra Agent should
be done one task at a time with parity tests.

Provider credentials live only in runtime configuration and environment
variables. They must never be added to workflow input, state, step output, or
trace attributes.

## Tracing and redaction

Trace records correlate episode ID, run ID, flow version, model task, logical
turn, retry count, latency, token usage, proposed/repaired/completed outcome,
and accepted speech ID when available. Keys that look like credentials and
values identified as prompts, sources, excerpts, documents, materials, or
long free text are replaced with `[REDACTED]` before export.

For troubleshooting, verify the data directory is writable, remove no live
SQLite files, and run `pnpm test:workflows`, `pnpm test` and `pnpm build`. A
missing model credential does not prevent composition-root construction; it
fails only when the compatibility route actually constructs that provider
model.

## Episode workflow

Pass `episodeWorkflowDependencies` to `createTweedyMastra()` to register the
typed `generate-episode` workflow. The dependencies are narrow adapters around
the existing repositories, inspector, direction proposer, assignment repair,
speaker generation, review and transactional persistence seams. Large
materials, speakers and voice records are loaded inside those adapters by
episode or entity ID and do not enter workflow snapshots.

The top-level workflow prepares materials, assigns roles, creates the plan,
executes the nested `produce-episode-turn` workflow in a bounded `doWhile`,
and finalises the compact `EpisodeState`. The nested graph separates episode
inspection, proposal, deterministic repair, generation, review, validation,
idempotent persistence and reducer acceptance. It reuses the same transaction
workflow for independent interjections.

Generation and persistence steps have bounded retries. Review remains
fail-open and material/RAG preparation remains best effort. Turn, duration and
iteration ceilings force an explicit final sign-off even if direction or
conclusion model calls fail. Snapshots are persisted after workflow steps, and
stable `episode/run/logical-turn/kind` keys make replay after a post-write
failure return the same speech record.

## Engine selection and resume safety

`ScriptService` resolves a `ConversationWorkflowEngine` before loading
generation inputs. Both implementations consume the same request and return
the same `PodcastScript` and `Speech` domain records, so export, editing and
audio generation remain engine-neutral.

Each new script records its engine name, flow version and workflow run ID.
Resume is refused if the requested engine or flow version differs from that
stored identity; active runs are never migrated between engines. Older scripts
without this metadata remain readable and editable, but are not treated as
resumable workflow runs.

## Inspecting runs with Mastra Studio

Run `pnpm studio` (from the repo root) to launch Mastra Studio at
`http://localhost:4111`, browsing this project's real `data/mastra.db` and
`data/mastra-traces.jsonl`. It reads the `generate-episode` workflow's past
runs (including failed and still-`running`/interrupted ones left over from a
killed process) directly from storage.

The entry point lives at `mastra-studio/index.ts`, outside `src/`, deliberately
kept separate from `src/mastra/index.ts` so that module's "importing has no
side effects" guarantee stays true for the CLI. It registers the real
`generate-episode` workflow definition (required for Studio to associate
stored snapshots with a workflow at all) but wires every dependency to throw
if called — Studio is for **inspecting recorded runs only**, it does not
re-execute steps or generate real content from this process. On startup,
Mastra tries to auto-resume every run left in a non-terminal status; expect
harmless `Failed to restart workflow run` log noise for old interrupted runs
whose dependencies are stubbed out.

Paths are resolved via `TWEEDY_PROJECT_ROOT` (defaults to this repo's known
location) rather than `process.cwd()`, because the bundled dev server does
not run with this repo as its working directory.
