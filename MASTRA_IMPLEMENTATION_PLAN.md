# Mastra Conversation Workflow Implementation Plan

## Status

Proposed.

Working branch: `feature/mastra-conversation-workflows`

## Objective

Replace Tweedy's implicit conversation-generation state machine with a typed,
observable workflow in which:

- Mastra owns orchestration, iteration, retries, persistence and tracing.
- LLM agents make bounded, schema-validated proposals.
- deterministic policies validate and repair proposals.
- a pure reducer is the only authority that changes conversation state.
- accepted turns are persisted idempotently and can survive workflow replay.

The migration must preserve the current conversation behaviour while making the
flow resumable, inspectable and independently testable.

## Current architecture

`ScriptService.generateScriptContent()` currently coordinates preparation,
planning, opening turns, completion checks, direction selection, speech
generation, review, repetition rejection, ledger updates, persistence and
interjections in one loop.

Some workflow state lives on `PodcastScript`, while other state is private to
`DirectorAgent` (`turnsUsed`, late-stage counters, plan and coverage state).
Several methods both call models and mutate orchestration state. Consequently,
replaying a failed iteration or resuming midway through a turn is difficult to
make deterministic.

## Design principles

1. **One serialisable state:** all orchestration state belongs to a
   Zod-validated `EpisodeState`.
2. **Proposals are not facts:** directions, candidate speech and reviews remain
   pending until an explicit acceptance transition.
3. **Pure transitions:** `reduceEpisode(state, event)` contains no I/O and is
   exhaustively testable.
4. **Deterministic authority:** pacing, opening order, repetition, role
   compatibility, cadence and termination limits remain TypeScript policies.
5. **Bounded agents:** each model call has one responsibility and a structured
   result.
6. **References in workflow state:** store entity IDs and compact editorial
   state, not source documents, voice objects or other large records.
7. **Idempotent effects:** persistence uses a stable key derived from the
   episode run and logical turn.
8. **Incremental replacement:** retain the existing generation path behind a
   feature flag until parity is demonstrated.

## Target flow

```text
generate-episode
├── initialise-episode
├── prepare-materials
├── assign-speaker-roles
├── create-episode-plan
├── conversation-loop [doWhile]
│   └── produce-turn
│       ├── inspect-episode
│       ├── select-opening-or-direct-turn
│       ├── generate-candidate
│       ├── review-candidate
│       ├── validate-and-repair
│       ├── accept-or-reject
│       └── maybe-interject
├── verify-ending
└── finalise-script
```

## State model

The state schema should include:

- workflow phase and schema/flow version;
- episode ID and workflow run ID;
- turn and late-stage counters;
- opening cursor;
- compact plan, discussion points and conversation beats;
- per-episode speaker-role assignments;
- accepted speech IDs;
- pending direction, candidate and review;
- knowledge and terminology ledgers;
- elapsed-duration estimate and time-pressure state;
- termination request and reason;
- warnings and the last applied transition.

Dates must be represented as ISO strings at the workflow boundary. Large
materials, full speaker records and voice configuration should be loaded by ID
inside the step that needs them.

## Event model

Start with a discriminated union containing:

- `EPISODE_INITIALISED`
- `MATERIALS_PREPARED`
- `ROLES_ASSIGNED`
- `PLAN_CREATED`
- `OPENING_ADVANCED`
- `TURN_DIRECTED`
- `TURN_GENERATED`
- `TURN_REVIEWED`
- `TURN_REJECTED`
- `TURN_ACCEPTED`
- `INTERJECTION_REQUESTED`
- `CLOSING_REQUESTED`
- `EPISODE_COMPLETED`
- `WORKFLOW_WARNING_RECORDED`

Reducers must reject invalid phase/event combinations instead of silently
repairing them.

## Component boundaries

### Workflow steps

Workflow steps sequence work, choose branches, apply retry policy and expose
traceable inputs and outputs. A step should not hide several model calls or an
entire turn lifecycle.

### Agents

Mastra agents are appropriate for material preparation, role casting, episode
planning, turn direction, speech generation, editorial review, coverage
verification and conclusion judgement.

### Deterministic policies

Keep opening order, pacing, speaker balance, dialogue cadence, response mode,
role repair, repetition detection, accessible-card selection, ledgers and hard
termination limits as plain TypeScript.

### Reducer

The reducer applies events to state. It performs no model calls, repository
writes, logging or random selection.

### Persistence adapter

The adapter persists an accepted speech before emitting `TURN_ACCEPTED`. Each
write uses an idempotency key:

```text
episodeId/workflowRunId/logicalTurn/kind
```

On replay, the adapter returns the existing record. State is updated only after
that operation succeeds.

## Delivery phases

### Phase 1: establish the state-machine seam

- Add `EpisodeDefinition`, `EpisodeState`, `EpisodeEvent` and their Zod schemas.
- Add a pure reducer and transition tests.
- Move director-owned counters and plan/coverage state into `EpisodeState`.
- Do not add Mastra runtime code in this phase.

Exit criterion: the current orchestration can express every meaningful change
as a reducer event, and invalid transitions are covered by tests.

### Phase 2: separate decisions from transitions

- Extract deterministic episode inspection from `DirectorAgent`.
- Change direction selection into a proposal-only structured call.
- Apply coverage verification, speaker resolution, role repair and cadence
  repair outside the agent.
- Ensure none of these operations mutates accepted state.

Exit criterion: directing a turn is a pure input/output pipeline until its
resulting event reaches the reducer.

### Phase 3: make a turn transactional

- Introduce `PendingTurn`.
- Extract generate, review, repair, repetition validation and accept/reject
  operations.
- Add idempotent accepted-turn persistence.
- Update ledgers and duration only on `TURN_ACCEPTED`.
- Treat interjections as their own logical accepted turns.

Exit criterion: the turn workflow can be safely retried after any individual
operation without duplicating or partially accepting a turn.

### Phase 4: introduce Mastra

- Add Mastra and the required AI SDK provider packages.
- Register existing model routes as Mastra runtime context/configuration.
- Implement typed steps and the nested `produce-turn` workflow.
- Implement the episode `doWhile` workflow.
- Configure local workflow storage and tracing.
- Keep existing RAG and TTS provider layers unchanged.

Exit criterion: an episode can be generated through Mastra with traceable,
schema-validated step boundaries.

### Phase 5: integrate and prove parity

- Add `legacy` and `mastra` generation modes.
- Route CLI generation through the selected mode.
- Add deterministic scenario fixtures for opening, challenge/right-of-reply,
  repetition rejection, interjection, duration close and natural completion.
- Compare structural outcomes rather than exact model prose.
- Add failure-injection tests for retry and resume.

Exit criterion: Mastra mode satisfies the behavioural suite and a failed run can
resume without duplicate accepted turns.

### Phase 6: cut over and simplify

- Make Mastra the default.
- Retain the legacy path for one release or an explicitly agreed soak period.
- Add operational documentation and migration notes.
- Remove LangChain orchestration code after the rollback period.
- Evaluate RAG migration separately; it is not required for this cutover.

Exit criterion: the legacy orchestrator and unused LangChain model plumbing are
removed without affecting document processing, embeddings, TTS or research.

## Test strategy

### Unit tests

- every valid state/event transition;
- every invalid phase/event transition;
- deterministic inspection and repair policies;
- stable idempotency keys;
- snapshot schema serialisation and version handling.

### Workflow tests

- successful full run;
- rejected candidate followed by a replacement;
- reviewer failure using the current fail-open behaviour;
- persistence failure before acceptance;
- replay after persistence but before state update;
- suspend/resume at the plan and pending-turn boundaries;
- turn, duration and natural-completion termination.

### Behavioural tests

- enforced cold open and introductions;
- two-speaker ping-pong;
- challenged speaker's right of reply;
- experts excluded from forced cheap interjections;
- coverage claims independently verified;
- accepted-turn-only ledger updates;
- final sign-off remains the last speech.

## Observability

Each workflow run should expose:

- episode and run IDs;
- flow version and selected model route;
- phase and logical turn;
- step duration, retry count and token usage;
- proposed versus repaired direction;
- candidate rejection reason;
- accepted speech ID and idempotency key;
- coverage and termination changes.

Prompts and source excerpts must follow an explicit redaction policy before
production traces are exported.

## Rollout and rollback

- Add a configuration option such as
  `CONVERSATION_WORKFLOW_ENGINE=legacy|mastra`.
- Default to `legacy` during parity development.
- Run selected fixtures through both engines in CI.
- Switch the default only after resume/replay and behavioural tests pass.
- Rollback is a configuration change while the legacy implementation remains.
- Do not perform an in-place migration of active legacy runs; finish them with
  the engine that started them.

## Non-goals

- Replacing TTS or audio assembly.
- Rewriting all policies as prompts.
- Building a generic JSON state-machine language.
- Migrating local embeddings or RAG as part of workflow cutover.
- Requiring human approval during normal generation.
- Matching generated prose byte-for-byte between engines.

## Risks

| Risk | Mitigation |
| --- | --- |
| Framework API churn | Pin Mastra versions and isolate it behind workflow adapters. |
| Snapshots become too large | Store IDs and compact state; load source entities per step. |
| Duplicate speech after replay | Stable idempotency keys and repository uniqueness. |
| Behaviour drifts during decomposition | Characterisation fixtures before changing prompts. |
| Prompt/model changes are confused with orchestration changes | Preserve prompts initially and migrate one model task at a time. |
| Existing repository schema cannot enforce idempotency | Add a lookup/index contract before enabling retries. |
| Traces expose source material | Redaction and opt-in production exporters. |

## Ticket order

1. [#9 Define episode workflow state, events and pure reducer](https://github.com/bazmatic/tweedy/issues/9).
2. [#8 Extract episode inspection and proposal-only turn direction](https://github.com/bazmatic/tweedy/issues/8).
3. [#11 Implement transactional turn production and idempotent acceptance](https://github.com/bazmatic/tweedy/issues/11).
4. [#10 Add Mastra runtime, model routing, storage and tracing](https://github.com/bazmatic/tweedy/issues/10).
5. [#12 Implement nested Mastra turn and episode workflows](https://github.com/bazmatic/tweedy/issues/12).
6. [#14 Add legacy/Mastra engine selection and CLI integration](https://github.com/bazmatic/tweedy/issues/14).
7. [#13 Build conversation workflow parity, retry and resume test suites](https://github.com/bazmatic/tweedy/issues/13).
8. [#15 Cut over conversation generation to Mastra and remove obsolete LangChain orchestration](https://github.com/bazmatic/tweedy/issues/15).

Tickets 2 and 3 depend on ticket 1. Ticket 4 can begin after the state schema is
stable. Ticket 5 depends on tickets 2–4. Tickets 6 and 7 depend on ticket 5.
Ticket 8 depends on successful rollout of tickets 6 and 7.
