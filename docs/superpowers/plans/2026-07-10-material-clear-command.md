# Material Clear Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `tweedy material clear` CLI command that bulk-deletes all ingested material records from `data/materials/`.

**Architecture:** Add a `deleteAll()` primitive to `MaterialRepository`, expose it through `MaterialService.clearAllMaterials()`, and wire a new `material clear` subcommand in `MaterialCommands.ts` that confirms via `inquirer` (skippable with `-y`/`--yes`) before deleting.

**Tech Stack:** TypeScript, vitest (test runner: `npm test` → `vitest run`), fs-extra (file persistence), commander (CLI), inquirer (already a dependency, used for the confirmation prompt).

## Global Constraints

- Scope is limited to `data/materials/*.json` records. Do not touch the repo-root `material/` scratch folder or the vector store/embeddings — both are explicitly out of scope per the spec (`docs/superpowers/specs/2026-07-10-material-clear-command-design.md`).
- Follow the existing repository → service → CLI layering already used by `add`/`delete`/`list` in this codebase. Do not add a bulk-delete primitive to `BaseRepository` — this codebase does not have a bulk-delete abstraction there, and no other repository needs one; keep it local to `MaterialRepository`.
- Test framework is vitest; mock dependencies with `vi.fn()`/`vi.mock()` rather than hitting real disk or real prompts, matching the existing tests in `src/services/ScriptService.test.ts`.

---

### Task 1: `MaterialRepository.deleteAll()`

**Files:**
- Modify: `src/repositories/MaterialRepository.ts`
- Modify: `src/types/index.ts:238-250` (add `deleteAll` to `IMaterialRepository`)
- Test: `src/repositories/MaterialRepository.test.ts` (new file)

**Interfaces:**
- Consumes: `BaseRepository.deleteRecord(id: string): Promise<void>` (protected, already exists), `this.getAll(): Promise<MaterialRecord[]>` (already exists on `MaterialRepository`).
- Produces: `MaterialRepository.deleteAll(): Promise<number>` — deletes every material record and returns the count deleted. `IMaterialRepository.deleteAll(): Promise<number>` — interface signature used by `MaterialService` in Task 2.

- [ ] **Step 1: Write the failing test**

Create `src/repositories/MaterialRepository.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("fs-extra", () => ({
  pathExists: vi.fn(),
  readdir: vi.fn(),
  readFile: vi.fn(),
  remove: vi.fn(),
  ensureDir: vi.fn(),
}));

import * as fs from "fs-extra";
import { MaterialRepository } from "./MaterialRepository";
import { SourceType } from "../types";

function makeRecordJson(id: string) {
  return JSON.stringify({
    id,
    title: `Title ${id}`,
    content: "content",
    source: "source",
    sourceType: SourceType.Manual,
    metadata: {},
    createdAt: new Date().toISOString(),
  });
}

describe("MaterialRepository.deleteAll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes every existing material record and returns the count", async () => {
    (fs.pathExists as any).mockResolvedValue(true);
    (fs.readdir as any).mockResolvedValue(["a.json", "b.json"]);
    (fs.readFile as any).mockImplementation((filePath: string) => {
      const id = filePath.includes("a.json") ? "a" : "b";
      return Promise.resolve(makeRecordJson(id));
    });
    (fs.remove as any).mockResolvedValue(undefined);

    const repository = new MaterialRepository();
    const count = await repository.deleteAll();

    expect(count).toBe(2);
    expect(fs.remove).toHaveBeenCalledTimes(2);
  });

  it("returns 0 when there are no material records", async () => {
    (fs.pathExists as any).mockResolvedValue(false);

    const repository = new MaterialRepository();
    const count = await repository.deleteAll();

    expect(count).toBe(0);
    expect(fs.remove).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/repositories/MaterialRepository.test.ts`
Expected: FAIL with `repository.deleteAll is not a function`

- [ ] **Step 3: Add `deleteAll` to the interface**

In `src/types/index.ts`, update `IMaterialRepository` (around line 238-250):

```typescript
export interface IMaterialRepository {
  create(
    material: Omit<MaterialRecord, "id" | "createdAt">
  ): Promise<MaterialRecord>;
  getById(id: string): Promise<MaterialRecord | null>;
  getAll(): Promise<MaterialRecord[]>;
  update(
    id: string,
    material: Partial<Omit<MaterialRecord, "id" | "createdAt">>
  ): Promise<MaterialRecord | null>;
  delete(id: string): Promise<boolean>;
  deleteAll(): Promise<number>;
  findBySource(source: string): Promise<MaterialRecord[]>;
}
```

- [ ] **Step 4: Implement `deleteAll` on `MaterialRepository`**

In `src/repositories/MaterialRepository.ts`, add this method (after `delete`, before `findBySource`):

```typescript
  async deleteAll(): Promise<number> {
    const materials = await this.getAll();
    for (const material of materials) {
      await this.deleteRecord(material.id);
    }
    return materials.length;
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/repositories/MaterialRepository.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add src/repositories/MaterialRepository.ts src/repositories/MaterialRepository.test.ts src/types/index.ts
git commit -m "feat: add MaterialRepository.deleteAll"
```

---

### Task 2: `MaterialService.clearAllMaterials()`

**Files:**
- Modify: `src/services/MaterialService.ts`
- Modify: `src/types/index.ts:355-363` (add `clearAllMaterials` to `IMaterialService`)
- Test: `src/services/MaterialService.test.ts` (new file)

**Interfaces:**
- Consumes: `MaterialRepository.deleteAll(): Promise<number>` (Task 1).
- Produces: `MaterialService.clearAllMaterials(): Promise<number>` — deletes all materials via the repository and returns the count deleted. `IMaterialService.clearAllMaterials(): Promise<number>` used by `MaterialCommands.ts` in Task 3.

- [ ] **Step 1: Write the failing test**

Create `src/services/MaterialService.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { MaterialService } from "./MaterialService";

function makeService(overrides: { materialRepository?: any; ragService?: any }) {
  return new MaterialService(
    overrides.materialRepository ?? ({} as any),
    overrides.ragService ?? ({} as any)
  );
}

describe("MaterialService.clearAllMaterials", () => {
  it("delegates to materialRepository.deleteAll and returns its count", async () => {
    const deleteAll = vi.fn().mockResolvedValue(3);
    const service = makeService({ materialRepository: { deleteAll } });

    const count = await service.clearAllMaterials();

    expect(count).toBe(3);
    expect(deleteAll).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/MaterialService.test.ts`
Expected: FAIL with `service.clearAllMaterials is not a function`

- [ ] **Step 3: Add `clearAllMaterials` to the interface**

In `src/types/index.ts`, update `IMaterialService` (around line 355-363):

```typescript
export interface IMaterialService {
  addMaterial(
    material: Omit<MaterialRecord, "id" | "createdAt">
  ): Promise<PodcastMaterial>;
  getMaterial(id: string): Promise<PodcastMaterial>;
  getAllMaterials(): Promise<PodcastMaterial[]>;
  deleteMaterial(id: string): Promise<void>;
  clearAllMaterials(): Promise<number>;
  searchMaterials(query: string): Promise<PodcastMaterial[]>;
}
```

- [ ] **Step 4: Implement `clearAllMaterials` on `MaterialService`**

In `src/services/MaterialService.ts`, add this method (after `deleteMaterial`, before `searchMaterials`):

```typescript
  async clearAllMaterials(): Promise<number> {
    return this.materialRepository.deleteAll();
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/services/MaterialService.test.ts`
Expected: PASS (1 test)

- [ ] **Step 6: Commit**

```bash
git add src/services/MaterialService.ts src/services/MaterialService.test.ts src/types/index.ts
git commit -m "feat: add MaterialService.clearAllMaterials"
```

---

### Task 3: `tweedy material clear` CLI command

**Files:**
- Modify: `src/cli/commands/MaterialCommands.ts`

**Interfaces:**
- Consumes: `materialService.getAllMaterials(): Promise<PodcastMaterial[]>` (existing), `materialService.clearAllMaterials(): Promise<number>` (Task 2), `inquirer.prompt` (existing dependency, not yet imported in this file), `logger.info`/`logger.success`/`logger.error` (existing, already imported in this file).
- Produces: `tweedy material clear [-y|--yes]` CLI subcommand. No other task depends on this.

- [ ] **Step 1: Add the `inquirer` import**

In `src/cli/commands/MaterialCommands.ts`, add to the top of the file (alongside the existing imports):

```typescript
import inquirer from "inquirer";
```

- [ ] **Step 2: Add the `clear` subcommand**

In `src/cli/commands/MaterialCommands.ts`, add this subcommand after the `delete <id>` command and before `return materialCommand;`:

```typescript
  materialCommand
    .command("clear")
    .description("Delete all materials")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (options) => {
      try {
        const materials = await materialService.getAllMaterials();

        if (materials.length === 0) {
          logger.info("No materials to clear.");
          return;
        }

        if (!options.yes) {
          const { confirmed } = await inquirer.prompt([
            {
              type: "confirm",
              name: "confirmed",
              message: `Delete ${materials.length} materials? This cannot be undone.`,
              default: false,
            },
          ]);

          if (!confirmed) {
            logger.info("Cancelled.");
            return;
          }
        }

        const count = await materialService.clearAllMaterials();
        logger.success(`Cleared ${count} materials.`);
      } catch (error) {
        logger.error("Failed to clear materials:", error);
      }
    });
```

- [ ] **Step 3: Type-check the project**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Manually verify the command**

Run: `npx ts-node src/index.ts material clear`
Expected: If no materials exist, prints `No materials to clear.`. If materials exist, prints a confirmation prompt; answering "n" prints `Cancelled.` and answering "y" deletes them and prints `Cleared N materials.`. Then run `npx ts-node src/index.ts material clear --yes` with at least one material present and confirm it deletes without prompting.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/MaterialCommands.ts
git commit -m "feat: add tweedy material clear command"
```
