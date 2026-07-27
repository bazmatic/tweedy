# Mastra runtime

Tweedy includes a Mastra composition root for incremental workflow migration.
The existing LangChain conversation generator remains the default. Set
`CONVERSATION_RUNTIME=mastra` only for explicitly migrated entrypoints; no
current CLI conversation command switches on this flag yet.

## Pinned compatibility line

Tweedy supports Node 20, so it pins Mastra core 0.23.3 and LibSQL storage
0.16.4. Mastra 1.x requires Node 22.13 or newer. AI SDK 5.0.76 and its OpenAI
2.0.53 and Anthropic 2.0.33 providers are pinned from the generation used by
this Mastra release. Upgrade these packages together and rerun the full test
suite. Do not use floating ranges.

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
SQLite files, and run `pnpm test` plus `pnpm build`. A missing model credential
does not prevent composition-root construction; it fails only when the
compatibility route actually constructs that provider model.
