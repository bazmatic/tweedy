# Mastra conversation cutover

Mastra is the default conversation engine. The legacy engine remains available
only as a configuration-level rollback during the cutover soak:

```env
CONVERSATION_WORKFLOW_ENGINE=legacy
```

The setting affects new runs only. A stored or active run keeps the engine,
flow version and run ID with which it started; Tweedy refuses cross-engine or
cross-version resume.

## Soak and success gate

Start the soak when this default reaches the deployment environment. Retain
the legacy implementation until all of these conditions hold:

- at least 7 consecutive days and 20 representative Mastra generations;
- at least 95% of runs complete without operator intervention;
- 100% of completed episodes end with an explicit final turn;
- zero duplicate accepted speech IDs or speech records;
- zero credential, prompt or source-text leaks in exported traces;
- retrying or resuming a run never changes its accepted-turn identity;
- script load, editable export/import and audio generation remain healthy.

Do not infer success from unit tests alone. Record the deployment start date,
sample size and observed rates in the release or deployment record. Legacy
removal is a separate change after this gate passes.

## What to monitor

Use `MASTRA_TRACE_PATH` and the workflow snapshot store to review:

- completed versus failed outcomes;
- retry frequency and recurring failing model tasks;
- accepted speech IDs and duplicate-prevention behavior;
- final-turn completion and termination reasons;
- token usage and unusually long workflow latency;
- redaction (`[REDACTED]`) for prompts, source excerpts and credentials.

Never upload the SQLite database, trace file or provider credentials to an
issue. Share only redacted, minimal diagnostics.

## Rollback

1. Set `CONVERSATION_WORKFLOW_ENGINE=legacy`.
2. Restart the CLI process or deployment so configuration is reloaded.
3. Leave active Mastra runs and `mastra.db` untouched.
4. Start new generations with the legacy engine while investigating.
5. Restore `mastra` only after focused workflow and representative generation
   checks pass.

Rollback does not rewrite existing scripts, migrate active runs, or delete
snapshots. Scripts remain readable, editable and synthesizable regardless of
their generation engine.

## Verification commands

```bash
pnpm build
pnpm test:workflows
pnpm test
```

The focused suite is deterministic and uses no paid API. Before retiring the
legacy engine, also run approved representative generations through both
`--engine mastra` and `--engine legacy`, then verify script export and audio.

## Dependency and removal audit

No LangChain package is removable at cutover:

- `BaseAgent` remains the model-call compatibility layer used by
  `DirectorAgent`, `SpeakerAgent`, material preparation and turn review.
- `AiModelFactory` still constructs LangChain OpenAI and Anthropic models.
- local RAG uses LangChain documents, text splitting and vector storage.
- several TTS/effect providers use LangChain message/model adapters.

The Mastra workflow intentionally routes current `ModelTask` operations through
this compatibility layer. Remove the legacy loop and obsolete adapters only
after the soak gate, then repeat a repository-wide caller and dependency audit.
