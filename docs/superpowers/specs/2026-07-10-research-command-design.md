# `research` command design

## Purpose

Add a new `tweedy research <query>` CLI command that fetches material on a
topic from an external research provider and saves the results as
`PodcastMaterial` records, the same way `tweedy material add` does today —
so researched content is immediately available for script generation and
semantic search via the existing RAG pipeline.

The first (and only, for now) provider is Perplexity's chat completions API,
implemented behind a provider interface so additional research providers can
be added later without touching the CLI or service layer.

## Non-goals

- No new persistence layer — reuses `MaterialRepository`/`MaterialService`.
- No UI beyond the CLI command.
- No retry/backoff logic beyond what axios does by default.

## Types (`src/types/index.ts`)

```ts
export enum ResearchProviderName {
  Perplexity = "perplexity",
}

// existing enum, one new member added
export enum SourceType {
  Claude = "claude",
  Document = "document",
  Web = "web",
  Manual = "manual",
  Research = "research",
}

export interface ResearchMaterial {
  title: string;
  content: string;
  source: string; // URL for citations, "perplexity" for the synthesized answer
  sourceType: SourceType;
  metadata: Record<string, any>;
}

export interface IResearchProvider {
  research(query: string): Promise<ResearchMaterial[]>;
}
```

`ResearchMaterial` is a provider-output-only shape (no `id`/`createdAt`),
mirroring how `IDocumentProcessor` returns `ProcessedDocument` rather than a
full `MaterialRecord`. `ResearchService` is responsible for turning these
into persisted materials.

## `PerplexityProvider` (`src/providers/PerplexityProvider.ts`)

- Implements `IResearchProvider`.
- Reads `PERPLEXITY_API_KEY` from the environment; throws a clear error if
  missing (matching the pattern in `AiModelFactory`).
- Calls Perplexity's chat completions endpoint with the query as a single
  user message, using the `sonar` model.
- Maps the response into `ResearchMaterial[]`:
  - **One material for the synthesized answer** — `sourceType: Research`,
    `source: "perplexity"`, `metadata` includes the raw `citations` array
    and token usage.
  - **One material per citation URL** — fetched via the existing
    `DocumentProcessorFactory` (reusing `HTMLProcessor`) to extract a real
    title and page content, `sourceType: Web`, `source: <url>`.
  - If fetching an individual citation fails (dead link, timeout, paywall),
    log a warning and skip just that citation — the rest of the research
    call still succeeds. A citation-fetch failure never fails the whole
    command.

## `ResearchProviderFactory` (`src/providers/ResearchProviderFactory.ts`)

Same map-caching structure as `VocalProviderFactory`/`AiModelFactory`:
switches on `ResearchProviderName`, lazily constructs and caches provider
instances.

## `ResearchService` (`src/services/ResearchService.ts`)

```ts
class ResearchService {
  constructor(
    private readonly materialService: MaterialService,
    private readonly provider: ResearchProviderName = ResearchProviderName.Perplexity
  ) {}

  async research(query: string, namePrefix?: string): Promise<PodcastMaterial[]>;
}
```

- Resolves the provider via `ResearchProviderFactory.getProvider(this.provider)`.
- Calls `provider.research(query)` to get `ResearchMaterial[]`.
- For each result, calls `materialService.addMaterial(...)` — title is
  `namePrefix` + the provider's title when a prefix is given, otherwise just
  the provider's title. This persists to the material repository and
  indexes into RAG, same as every other material.
- Returns the resulting `PodcastMaterial[]`.

## CLI (`src/cli/commands/ResearchCommands.ts`)

```
tweedy research <query> [-n, --name <name>] [-p, --provider <provider>]
```

- `<query>` — positional, the research request text.
- `--name` — optional title prefix for created materials (matches `material add`'s `-n/--name` convention).
- `--provider` — optional, defaults to `perplexity` (the only available provider).

Wires up `MaterialRepository` → `RAGService` → `MaterialService` →
`ResearchService`, calls `research()`, and prints a summary listing each
material added (title + source), following the logging style already used
in `MaterialCommands.ts`. Registered in `src/cli/index.ts` alongside the
other top-level commands.

## Environment

Add `PERPLEXITY_API_KEY` as a required environment variable for this
feature (no `.env.example` currently exists in this repo, so there's
nothing to update there — document it in the command's error message only,
matching `AiModelFactory`'s existing pattern).

## Testing

- `PerplexityProvider` unit test: mock the HTTP call (answer + citations),
  assert correct `ResearchMaterial[]` shape is produced, and assert that a
  citation-fetch failure is skipped rather than thrown.
- `ResearchService` unit test: mock the provider and `MaterialService`,
  assert `addMaterial` is called once per `ResearchMaterial` with the
  expected title/source/sourceType, mirroring the style of
  `ScriptService.test.ts`.
