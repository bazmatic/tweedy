# Per-material summarization before plan creation

## Problem

`DirectorAgent.createPodcastPlan` concatenates the full raw `content` of every
`PodcastMaterial` into a single prompt (`src/agents/DirectorAgent.ts`,
`materialText`). For long or multiple source articles this bloats the input,
leaves less room for the plan's own output, and produces a weaker plan since
raw article text isn't shaped for a spoken conversation.

## Goal

Before the director builds its plan, summarize each material individually
with a view toward podcast use — key facts, hooks, angles worth discussing —
and feed those summaries into the plan prompt instead of raw content.

## Design

### New: `MaterialSummarizerAgent`

- File: `src/agents/MaterialSummarizerAgent.ts`, extends `BaseAgent`.
- One public method:
  ```ts
  async summarize(
    material: PodcastMaterial,
    context: { title: string; description: string }
  ): Promise<string>
  ```
- Uses `callModel` (plain text completion, no tool call — the output is just
  prose) with a prompt along the lines of:

  > You're prepping source material for a podcast titled "{title}":
  > {description}. Summarize the following article with an eye toward what's
  > useful in a spoken conversation — key facts, hooks, interesting angles,
  > things worth debating. 2-3 short paragraphs max.
  >
  > {material.content}

- Token budget: similar order of magnitude to other short generations in
  this codebase (e.g. ~300 tokens) — enough for 2-3 paragraphs.
- On model failure, catch the error, `logger.warn`, and fall back to a
  truncated slice of the raw content (same defensive pattern already used in
  `SpeakerAgent.getRelevantMaterials`), so one bad summarization call doesn't
  fail the whole plan.

### `DirectorAgent.createPodcastPlan` changes

- Before building the plan prompt, run all materials through the summarizer
  concurrently:
  ```ts
  const summaries = await Promise.all(
    this.script.materials.map((material) =>
      this.materialSummarizer.summarize(material, {
        title: this.script.title,
        description: this.script.description,
      })
    )
  );
  ```
- Build `materialText` by zipping each material's `title` with its summary
  (`title: summary`), replacing the current `title: content` join.
- `DirectorAgent` instantiates one `MaterialSummarizerAgent` (constructor or
  lazily on first use) — no new constructor parameters needed elsewhere in
  the app, keeping `ScriptService`'s call site unchanged.

### Non-goals

- No persistence/caching of summaries on `PodcastMaterial` or in
  `MaterialRepository` — summaries are regenerated fresh every time a script
  is created, consistent with how the rest of this pipeline already treats
  materials (RAG store is rebuilt from repository records on every CLI
  invocation too).
- No change to `chooseNextSpeaker` or `SpeakerAgent`'s own material lookup
  (`getRelevantMaterials`) — that path already does its own RAG-based
  selection and truncation and is out of scope here.

## Testing

- New `src/agents/MaterialSummarizerAgent.test.ts`:
  - happy path: `callModel` mocked to return a summary string, verify it's
    returned as-is.
  - failure path: `callModel` mocked to reject, verify the fallback
    (truncated raw content) is returned instead of throwing.
- Update `src/agents/DirectorAgent.test.ts`: the existing
  `createPodcastPlan` test currently only mocks `callModelForToolInput`; add
  a mock/spy for the summarizer (e.g. spy on
  `MaterialSummarizerAgent.prototype.summarize`) so the test doesn't make
  real model calls, and add a case asserting the plan prompt's material
  section uses summarized text rather than raw `content`.
