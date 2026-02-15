# Code Agent Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable kanban cards to trigger autonomous code changes using Claude Code CLI in isolated git worktrees, with a plan-review-execute flow.

**Architecture:** Cards get assigned a repo. Moving to "In Process" creates a worktree and generates a plan via Claude. The plan renders as markdown in the detail panel. User clicks Execute to spawn Claude Code in the worktree, which commits and creates a PR. Repos are managed in settings, stored via SettingsRepo.

**Tech Stack:** Express, better-sqlite3, child_process (spawn), git CLI, gh CLI, react-markdown, existing SSE streaming infrastructure.

---

### Task 1: Add react-markdown dependency

**Files:**
- Modify: `client/package.json`

**Step 1: Install react-markdown**

Run: `cd client && npm install react-markdown`

**Step 2: Commit**

```bash
git add client/package.json client/package-lock.json
git commit -m "chore: add react-markdown dependency"
```

---

### Task 2: Repos CRUD — server route

**Files:**
- Create: `server/src/routes/repos.ts`
- Modify: `server/src/index.ts:60-74`

**Step 1: Create repos router**

Create `server/src/routes/repos.ts`:

```typescript
import { Router } from "express";
import crypto from "crypto";
import { execFileSync } from "child_process";
import type { SettingsRepo } from "../db/settings-repo.js";

interface Repo {
  id: string;
  name: string;
  path: string;
}

export function createReposRouter(settingsRepo: SettingsRepo): Router {
  const router = Router();

  function getRepos(): Repo[] {
    return settingsRepo.get<Repo[]>("repos", []);
  }

  router.get("/", (_req, res) => {
    const repos = getRepos();
    const defaultRepoId = settingsRepo.get<string | null>("default_repo_id", null);
    res.json({ repos, default_repo_id: defaultRepoId });
  });

  router.post("/", (req, res) => {
    const { name, path } = req.body;
    if (!name || !path) {
      res.status(400).json({ error: "name and path are required" });
      return;
    }

    // Validate path is a git repo
    try {
      execFileSync("git", ["-C", path, "rev-parse", "--git-dir"], { timeout: 5000 });
    } catch {
      res.status(400).json({ error: "Path is not a valid git repository" });
      return;
    }

    const repos = getRepos();
    const repo: Repo = { id: crypto.randomUUID(), name, path };
    repos.push(repo);
    settingsRepo.set("repos", repos);
    res.status(201).json(repo);
  });

  router.delete("/:id", (req, res) => {
    const repos = getRepos();
    const filtered = repos.filter((r) => r.id !== req.params.id);
    if (filtered.length === repos.length) {
      res.status(404).json({ error: "Repo not found" });
      return;
    }
    settingsRepo.set("repos", filtered);

    // Clear default if it was the deleted repo
    const defaultId = settingsRepo.get<string | null>("default_repo_id", null);
    if (defaultId === req.params.id) {
      settingsRepo.set("default_repo_id", null);
    }

    res.json({ success: true });
  });

  router.patch("/default", (req, res) => {
    const { repo_id } = req.body;
    settingsRepo.set("default_repo_id", repo_id ?? null);
    res.json({ success: true });
  });

  return router;
}
```

**Step 2: Mount repos router in index.ts**

In `server/src/index.ts`, add after the existing route imports:

```typescript
import { createReposRouter } from "./routes/repos.js";
```

Add after the settings router mount:

```typescript
app.use("/api/repos", createReposRouter(settingsRepo));
```

**Step 3: Run tests to make sure nothing broke**

Run: `cd server && npx vitest run`
Expected: All 41 tests pass.

**Step 4: Commit**

```bash
git add server/src/routes/repos.ts server/src/index.ts
git commit -m "feat: add repos CRUD router"
```

---

### Task 3: Assign repo to card — server endpoint

**Files:**
- Modify: `server/src/routes/cards.ts:38-45`
- Modify: `server/src/db/card-repo.ts`

**Step 1: Add setMetadata method to CardRepo**

In `server/src/db/card-repo.ts`, add after the `setExecutionResult` method:

```typescript
setMetadataField(id: number, key: string, value: unknown): void {
  const card = this.getById(id);
  if (!card) return;
  const metadata = card.metadata || {};
  metadata[key] = value;
  this.db
    .prepare("UPDATE cards SET metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(JSON.stringify(metadata), id);
}
```

**Step 2: Add PATCH /:id/repo endpoint to cards router**

In `server/src/routes/cards.ts`, add before `return router;`:

```typescript
router.patch("/:id/repo", (req, res) => {
  const id = Number(req.params.id);
  const { repo_id } = req.body;
  cardRepo.setMetadataField(id, "repo_id", repo_id);
  const card = cardRepo.getById(id);
  res.json(card);
});
```

**Step 3: Run tests**

Run: `cd server && npx vitest run`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add server/src/routes/cards.ts server/src/db/card-repo.ts
git commit -m "feat: add repo assignment endpoint for cards"
```

---

### Task 4: Worktree manager

**Files:**
- Create: `server/src/git/worktree-manager.ts`

**Step 1: Create worktree manager module**

Create `server/src/git/worktree-manager.ts`:

```typescript
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";

const execFileAsync = promisify(execFile);

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export interface WorktreeInfo {
  worktreePath: string;
  branchName: string;
}

export class WorktreeManager {
  async create(repoPath: string, cardId: number, title: string): Promise<WorktreeInfo> {
    const branchName = `kanban/${cardId}-${slugify(title)}`;
    const worktreeDir = path.resolve(repoPath, "..", "worktrees");
    const worktreePath = path.join(worktreeDir, `card-${cardId}`);

    // Create worktrees directory if needed
    if (!fs.existsSync(worktreeDir)) {
      fs.mkdirSync(worktreeDir, { recursive: true });
    }

    // If worktree already exists, reuse it
    if (fs.existsSync(worktreePath)) {
      return { worktreePath, branchName };
    }

    // Check if branch exists, delete if orphaned
    try {
      await execFileAsync("git", ["-C", repoPath, "rev-parse", "--verify", branchName], { timeout: 5000 });
      // Branch exists — try to reuse or delete
      await execFileAsync("git", ["-C", repoPath, "branch", "-D", branchName], { timeout: 5000 });
    } catch {
      // Branch doesn't exist, good
    }

    await execFileAsync(
      "git",
      ["-C", repoPath, "worktree", "add", worktreePath, "-b", branchName],
      { timeout: 10000 },
    );

    return { worktreePath, branchName };
  }

  async remove(worktreePath: string): Promise<void> {
    if (!fs.existsSync(worktreePath)) return;

    // Find the main repo from the worktree
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["-C", worktreePath, "rev-parse", "--path-format=absolute", "--git-common-dir"],
        { timeout: 5000 },
      );
      const gitCommonDir = stdout.trim();
      const repoPath = path.resolve(gitCommonDir, "..");

      // Get branch name before removing
      const { stdout: branchOut } = await execFileAsync(
        "git",
        ["-C", worktreePath, "rev-parse", "--abbrev-ref", "HEAD"],
        { timeout: 5000 },
      );
      const branchName = branchOut.trim();

      await execFileAsync("git", ["-C", repoPath, "worktree", "remove", worktreePath, "--force"], { timeout: 10000 });

      // Delete the branch
      if (branchName && branchName !== "HEAD") {
        try {
          await execFileAsync("git", ["-C", repoPath, "branch", "-D", branchName], { timeout: 5000 });
        } catch {
          // Branch may already be gone
        }
      }
    } catch (err) {
      console.error("Failed to remove worktree:", err);
      // Fallback: just delete the directory
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }
  }

  async commit(worktreePath: string, message: string): Promise<void> {
    await execFileAsync("git", ["-C", worktreePath, "add", "-A"], { timeout: 10000 });

    // Check if there are changes to commit
    try {
      await execFileAsync("git", ["-C", worktreePath, "diff", "--cached", "--quiet"], { timeout: 5000 });
      // No changes — skip commit
    } catch {
      // There are staged changes — commit
      await execFileAsync("git", ["-C", worktreePath, "commit", "-m", message], { timeout: 10000 });
    }
  }

  async createPR(worktreePath: string, title: string, body: string): Promise<string> {
    // Push the branch
    const { stdout: branchOut } = await execFileAsync(
      "git",
      ["-C", worktreePath, "rev-parse", "--abbrev-ref", "HEAD"],
      { timeout: 5000 },
    );
    const branchName = branchOut.trim();

    await execFileAsync("git", ["-C", worktreePath, "push", "-u", "origin", branchName], { timeout: 30000 });

    // Create PR
    const { stdout } = await execFileAsync(
      "gh",
      ["pr", "create", "--title", title, "--body", body, "--head", branchName],
      { cwd: worktreePath, timeout: 15000 },
    );

    // Return PR URL (last line of gh output)
    return stdout.trim().split("\n").pop() || "";
  }
}
```

**Step 2: Commit**

```bash
git add server/src/git/worktree-manager.ts
git commit -m "feat: add git worktree manager"
```

---

### Task 5: Plan generation — server-side

**Files:**
- Modify: `server/src/ai/claude-evaluator.ts`
- Modify: `server/src/routes/ai.ts`
- Modify: `server/src/index.ts`

**Step 1: Add `generatePlanStream` to ClaudeEvaluator**

In `server/src/ai/claude-evaluator.ts`, add a new method after `evaluateStream`:

```typescript
async generatePlanStream(
  card: Card,
  repoName: string,
  repoPath: string,
  worktreePath: string,
  onChunk: (text: string) => void,
  customRequest?: string,
  connectorRules?: string,
): Promise<string> {
  let prompt = `Create a detailed implementation plan for this task.

Task: ${card.title}
Description: ${card.body || "(no description)"}
Repository: ${repoName} (${repoPath})`;

  if (connectorRules) {
    prompt += `\n\nDefault rules:\n${connectorRules}`;
  }
  if (customRequest) {
    prompt += `\n\nUser request: ${customRequest}`;
  }

  prompt += `\n\nReturn ONLY a detailed markdown plan listing the files to change and what to do in each. No JSON wrapping.`;

  return new Promise((resolve) => {
    const child = spawn("claude", ["-p", prompt], {
      cwd: worktreePath,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60000,
    });

    let stdout = "";

    child.stdout.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;
      onChunk(chunk);
    });

    child.stderr.on("data", (data: Buffer) => {
      console.error("Claude plan stderr:", data.toString());
    });

    child.on("close", (code) => {
      if (code !== 0) {
        console.error(`Claude plan exited with code ${code}`);
        resolve("Plan generation failed.");
        return;
      }

      // Try to unwrap JSON --output-format wrapper if present
      let result = stdout.trim();
      try {
        const wrapper = JSON.parse(result);
        if (wrapper.result) result = wrapper.result;
      } catch {
        // raw text, use as-is
      }

      resolve(result);
    });

    child.on("error", (err) => {
      console.error("Claude plan spawn error:", err);
      resolve("Plan generation failed.");
    });
  });
}
```

**Step 2: Update process-stream to handle code planning**

In `server/src/routes/ai.ts`, add the WorktreeManager import at the top:

```typescript
import { WorktreeManager } from "../git/worktree-manager.js";
```

Update the `createAiRouter` function signature to accept `settingsRepo`:

```typescript
import type { SettingsRepo } from "../db/settings-repo.js";

export function createAiRouter(
  cardRepo: CardRepo,
  evaluator: ClaudeEvaluator,
  registry: ConnectorRegistry,
  db: Database.Database,
  settingsRepo: SettingsRepo,
  confidenceThreshold: number = 80
): Router {
  const worktreeManager = new WorktreeManager();
```

Inside the `process-stream` endpoint, after `cardRepo.setAiToggle(cardId, true);` and before the evaluating send, add the code planning branch:

```typescript
// Check if card has a repo assigned — if so, do code planning instead of normal eval
const repoId = card.metadata?.repo_id as string | undefined;
if (repoId) {
  const repos = settingsRepo.get<{ id: string; name: string; path: string }[]>("repos", []);
  const repo = repos.find((r) => r.id === repoId);

  if (!repo) {
    send({ step: "error", message: "Assigned repo not found" });
    send({ step: "done", message: "Processing failed", card: cardRepo.getById(cardId) });
    res.end();
    return;
  }

  send({ step: "evaluating", message: `Creating worktree for ${repo.name}...` });

  const { worktreePath, branchName } = await worktreeManager.create(repo.path, cardId, card.title);
  cardRepo.setMetadataField(cardId, "worktree_path", worktreePath);
  cardRepo.setMetadataField(cardId, "branch_name", branchName);

  send({ step: "evaluating", message: "Generating implementation plan..." });

  const aiRules = getAiRules(db, card.source_type);
  const plan = await evaluator.generatePlanStream(
    card, repo.name, repo.path, worktreePath, (chunk) => {
      send({ step: "ai_output", message: chunk });
    }, customRequest, aiRules,
  );

  // Save plan to card body and move to review
  cardRepo.setBody(cardId, plan);
  cardRepo.setAiEvaluation(cardId, {
    confidence: 100,
    proposed_action: `Code change plan for ${repo.name}`,
    action_payload: { type: "code_change", repo_id: repoId },
  });
  cardRepo.moveToColumn(cardId, "review");

  const updated = cardRepo.getById(cardId);
  send({ step: "done", message: "Plan ready for review", card: updated });
  res.end();
  return;
}
```

**Step 3: Add `setBody` to CardRepo**

In `server/src/db/card-repo.ts`, add:

```typescript
setBody(id: number, body: string): void {
  this.db
    .prepare("UPDATE cards SET body = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(body, id);
}
```

**Step 4: Update index.ts to pass settingsRepo**

In `server/src/index.ts`, change:

```typescript
app.use("/api/ai", createAiRouter(cardRepo, evaluator, registry, db));
```

To:

```typescript
app.use("/api/ai", createAiRouter(cardRepo, evaluator, registry, db, settingsRepo));
```

**Step 5: Run tests**

Run: `cd server && npx vitest run`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add server/src/ai/claude-evaluator.ts server/src/routes/ai.ts server/src/db/card-repo.ts server/src/index.ts
git commit -m "feat: add code plan generation via process-stream"
```

---

### Task 6: Code execution — server endpoint

**Files:**
- Modify: `server/src/routes/ai.ts`

**Step 1: Add execute-code SSE endpoint**

In `server/src/routes/ai.ts`, add a new endpoint before `router.post("/execute/:cardId"`:

```typescript
router.post("/execute-code/:cardId", async (req, res) => {
  const cardId = Number(req.params.cardId);
  const card = cardRepo.getById(cardId);

  if (!card) {
    res.status(404).json({ error: "Card not found" });
    return;
  }

  const worktreePath = card.metadata?.worktree_path as string | undefined;
  const repoId = card.metadata?.repo_id as string | undefined;

  if (!worktreePath || !repoId) {
    res.status(400).json({ error: "Card has no worktree or repo assigned" });
    return;
  }

  const repos = settingsRepo.get<{ id: string; name: string; path: string }[]>("repos", []);
  const repo = repos.find((r) => r.id === repoId);

  if (!repo) {
    res.status(400).json({ error: "Assigned repo not found" });
    return;
  }

  // SSE setup
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    send({ step: "start", message: "Starting code execution..." });
    send({ step: "executing", message: `Running Claude Code in ${repo.name}...` });

    const plan = card.body || "";

    const { spawn } = await import("child_process");
    const child = spawn(
      "claude",
      [
        "-p",
        `Execute this implementation plan in the current repository.\n\nPlan:\n${plan}\n\nImplement all changes described. Run tests if applicable.`,
        "--allowedTools", "Bash,Read,Write,Edit,Glob,Grep",
      ],
      { cwd: worktreePath, stdio: ["ignore", "pipe", "pipe"], timeout: 300000 },
    );

    child.stdout.on("data", (data: Buffer) => {
      send({ step: "ai_output", message: data.toString() });
    });

    child.stderr.on("data", (data: Buffer) => {
      console.error("Claude execute stderr:", data.toString());
    });

    await new Promise<void>((resolve) => {
      child.on("close", (code) => {
        if (code !== 0) {
          send({ step: "error", message: `Claude Code exited with code ${code}` });
        }
        resolve();
      });
      child.on("error", (err) => {
        send({ step: "error", message: `Spawn error: ${err.message}` });
        resolve();
      });
    });

    // Commit changes
    send({ step: "executing", message: "Committing changes..." });
    await worktreeManager.commit(worktreePath, `feat: ${card.title}`);

    // Create PR
    send({ step: "executing", message: "Creating pull request..." });
    let prUrl = "";
    try {
      prUrl = await worktreeManager.createPR(
        worktreePath,
        card.title,
        `## Summary\n\n${card.proposed_action}\n\n## Plan\n\n${plan}\n\n---\nGenerated by Daily Kanban AI`,
      );
      send({ step: "executed", message: `PR created: ${prUrl}` });
    } catch (err) {
      send({ step: "error", message: `PR creation failed: ${(err as Error).message}` });
    }

    // Clean up worktree
    send({ step: "executing", message: "Cleaning up worktree..." });
    await worktreeManager.remove(worktreePath);
    cardRepo.setMetadataField(cardId, "worktree_path", null);

    // Update card
    cardRepo.setExecutionResult(cardId, prUrl ? `PR: ${prUrl}` : "Code changes committed");
    cardRepo.moveToColumn(cardId, "done");

    const updated = cardRepo.getById(cardId);
    send({ step: "done", message: prUrl ? `Done! PR: ${prUrl}` : "Done!", card: updated });
  } catch (err) {
    console.error("Execute-code error:", err);
    send({ step: "error", message: "Code execution failed" });
    send({ step: "done", message: "Execution failed", card: cardRepo.getById(cardId) });
  }

  res.end();
});
```

**Step 2: Run tests**

Run: `cd server && npx vitest run`
Expected: All tests pass.

**Step 3: Commit**

```bash
git add server/src/routes/ai.ts
git commit -m "feat: add execute-code SSE endpoint"
```

---

### Task 7: Client API methods

**Files:**
- Modify: `client/src/lib/api.ts`

**Step 1: Add repo and execute-code API methods**

In `client/src/lib/api.ts`, add before `purgeBoard`:

```typescript
getRepos: () =>
  fetchJson<{ repos: { id: string; name: string; path: string }[]; default_repo_id: string | null }>("/repos"),

addRepo: (name: string, path: string) =>
  fetchJson<{ id: string; name: string; path: string }>("/repos", {
    method: "POST",
    body: JSON.stringify({ name, path }),
  }),

deleteRepo: (id: string) =>
  fetchJson<{ success: boolean }>(`/repos/${id}`, { method: "DELETE" }),

setDefaultRepo: (repo_id: string | null) =>
  fetchJson<{ success: boolean }>("/repos/default", {
    method: "PATCH",
    body: JSON.stringify({ repo_id }),
  }),

setCardRepo: (cardId: number, repo_id: string) =>
  fetchJson<Card>(`/cards/${cardId}/repo`, {
    method: "PATCH",
    body: JSON.stringify({ repo_id }),
  }),

executeCodeStream: (
  cardId: number,
  onEvent: (event: { step: string; message: string; card?: Card }) => void,
): { abort: () => void } => {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${BASE}/ai/execute-code/${cardId}`, {
        method: "POST",
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        onEvent({ step: "error", message: `API error: ${res.status}` });
        onEvent({ step: "done", message: "Execution failed" });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const event = JSON.parse(line.slice(6));
              onEvent(event);
            } catch {
              // skip malformed
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        onEvent({ step: "error", message: "Connection failed" });
        onEvent({ step: "done", message: "Execution failed" });
      }
    }
  })();

  return { abort: () => controller.abort() };
},
```

**Step 2: Commit**

```bash
git add client/src/lib/api.ts
git commit -m "feat: add repo and execute-code API client methods"
```

---

### Task 8: useAiProcessing — add executeCode

**Files:**
- Modify: `client/src/hooks/useAiProcessing.ts`

**Step 1: Add startExecution method**

Replace the full file with:

```typescript
import { useState, useRef, useCallback } from "react";
import type { Card } from "@daily-kanban/shared";
import { api } from "../lib/api";

export interface ProcessingLog {
  step: string;
  message: string;
}

export function useAiProcessing() {
  const [processingCardId, setProcessingCardId] = useState<number | null>(null);
  const [logs, setLogs] = useState<ProcessingLog[]>([]);
  const abortRef = useRef<{ abort: () => void } | null>(null);

  const startProcessing = useCallback(
    (cardId: number, onCardUpdate: (card: Card) => void, customRequest?: string) => {
      abortRef.current?.abort();

      setProcessingCardId(cardId);
      setLogs([]);

      const handle = api.processCardStream(cardId, (event) => {
        setLogs((prev) => [...prev, { step: event.step, message: event.message }]);
        if (event.step === "done" && event.card) {
          onCardUpdate(event.card);
          setProcessingCardId(null);
        }
      }, customRequest);

      abortRef.current = handle;
    },
    [],
  );

  const startExecution = useCallback(
    (cardId: number, onCardUpdate: (card: Card) => void) => {
      abortRef.current?.abort();

      setProcessingCardId(cardId);
      setLogs([]);

      const handle = api.executeCodeStream(cardId, (event) => {
        setLogs((prev) => [...prev, { step: event.step, message: event.message }]);
        if (event.step === "done" && event.card) {
          onCardUpdate(event.card);
          setProcessingCardId(null);
        }
      });

      abortRef.current = handle;
    },
    [],
  );

  return { processingCardId, logs, startProcessing, startExecution };
}
```

**Step 2: Commit**

```bash
git add client/src/hooks/useAiProcessing.ts
git commit -m "feat: add startExecution to useAiProcessing hook"
```

---

### Task 9: CardDetailPanel — repo selector, markdown viewer, execute button

**Files:**
- Modify: `client/src/components/CardDetailPanel.tsx`

**Step 1: Update CardDetailPanel**

Add imports at the top:

```typescript
import Markdown from "react-markdown";
```

Update the props interface:

```typescript
interface CardDetailPanelProps {
  card: Card;
  onClose: () => void;
  processingLogs?: ProcessingLog[];
  onProcess?: (customRequest?: string) => void;
  onExecuteCode?: () => void;
  repos?: { id: string; name: string; path: string }[];
  defaultRepoId?: string | null;
  onRepoChange?: (repoId: string) => void;
}
```

Update the function signature:

```typescript
export function CardDetailPanel({ card, onClose, processingLogs, onProcess, onExecuteCode, repos, defaultRepoId, onRepoChange }: CardDetailPanelProps) {
```

Add repo selector after the title section (after the `</div>` that closes the title block around line 112):

```tsx
{repos && repos.length > 0 && onRepoChange && (
  <div>
    <h3 className="text-sm font-medium mb-1">Repository</h3>
    <select
      value={(card.metadata?.repo_id as string) || defaultRepoId || ""}
      onChange={(e) => onRepoChange(e.target.value)}
      className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <option value="">No repo</option>
      {repos.map((r) => (
        <option key={r.id} value={r.id}>{r.name} — {r.path}</option>
      ))}
    </select>
  </div>
)}
```

Replace the plain-text body rendering with a markdown-aware version:

```tsx
{card.body && (
  <div>
    <h3 className="text-sm font-medium mb-1">
      {card.metadata?.repo_id && card.column_name === "review" ? "Implementation Plan" : "Description"}
    </h3>
    {card.metadata?.repo_id && card.column_name === "review" ? (
      <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
        <Markdown>{card.body}</Markdown>
      </div>
    ) : (
      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{card.body}</p>
    )}
  </div>
)}
```

Add the Execute button after the AI Proposed Action section, before the execution result:

```tsx
{card.column_name === "review" && card.metadata?.repo_id && onExecuteCode && !isProcessing && (
  <Button onClick={onExecuteCode} className="w-full">
    Execute Code Changes
  </Button>
)}
```

**Step 2: Type-check**

Run: `cd client && npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add client/src/components/CardDetailPanel.tsx
git commit -m "feat: add repo selector, markdown plan viewer, and execute button to detail panel"
```

---

### Task 10: Board.tsx — wire up repos and execute

**Files:**
- Modify: `client/src/components/Board.tsx`

**Step 1: Add repo state and execute wiring**

Add state and effects for repos. After the existing state declarations:

```typescript
const [repos, setRepos] = useState<{ id: string; name: string; path: string }[]>([]);
const [defaultRepoId, setDefaultRepoId] = useState<string | null>(null);

useEffect(() => {
  api.getRepos().then((data) => {
    setRepos(data.repos);
    setDefaultRepoId(data.default_repo_id);
  });
}, []);
```

Add a handler for repo changes:

```typescript
const handleRepoChange = async (cardId: number, repoId: string) => {
  const updated = await api.setCardRepo(cardId, repoId);
  updateCard(updated);
};
```

Update the `useAiProcessing` destructure to include `startExecution`:

```typescript
const { processingCardId, logs, startProcessing, startExecution } = useAiProcessing();
```

Update the CardDetailPanel rendering to pass new props:

```tsx
{currentSelectedCard && (
  <CardDetailPanel
    card={currentSelectedCard}
    onClose={() => setSelectedCard(null)}
    processingLogs={processingCardId === currentSelectedCard.id ? logs : undefined}
    onProcess={(customRequest) => startProcessing(currentSelectedCard.id, updateCard, customRequest)}
    onExecuteCode={() => startExecution(currentSelectedCard.id, updateCard)}
    repos={repos}
    defaultRepoId={defaultRepoId}
    onRepoChange={(repoId) => handleRepoChange(currentSelectedCard.id, repoId)}
  />
)}
```

**Step 2: Import useEffect**

Update the React import:

```typescript
import { useState, useEffect } from "react";
```

**Step 3: Type-check**

Run: `cd client && npx tsc --noEmit`
Expected: No errors.

**Step 4: Commit**

```bash
git add client/src/components/Board.tsx
git commit -m "feat: wire up repos and code execution in board"
```

---

### Task 11: Settings page — repos management

**Files:**
- Modify: `client/src/components/Settings.tsx`

**Step 1: Add repos section to Settings**

Add state after the existing state declarations:

```typescript
const [repos, setRepos] = useState<{ id: string; name: string; path: string }[]>([]);
const [defaultRepoId, setDefaultRepoId] = useState<string | null>(null);
const [newRepoName, setNewRepoName] = useState("");
const [newRepoPath, setNewRepoPath] = useState("");
```

Add fetch in the existing useEffect:

```typescript
fetch("/api/repos")
  .then((r) => r.json())
  .then((data) => {
    setRepos(data.repos);
    setDefaultRepoId(data.default_repo_id);
  });
```

Add handlers:

```typescript
const handleAddRepo = async () => {
  if (!newRepoName || !newRepoPath) return;
  try {
    const res = await fetch("/api/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newRepoName, path: newRepoPath }),
    });
    if (!res.ok) {
      const err = await res.json();
      toast.error(err.error || "Failed to add repo");
      return;
    }
    const repo = await res.json();
    setRepos((prev) => [...prev, repo]);
    setNewRepoName("");
    setNewRepoPath("");
    toast.success("Repository added");
  } catch {
    toast.error("Failed to add repo");
  }
};

const handleDeleteRepo = async (id: string) => {
  try {
    await fetch(`/api/repos/${id}`, { method: "DELETE" });
    setRepos((prev) => prev.filter((r) => r.id !== id));
    if (defaultRepoId === id) setDefaultRepoId(null);
    toast.success("Repository removed");
  } catch {
    toast.error("Failed to remove repo");
  }
};

const handleSetDefaultRepo = async (repoId: string) => {
  const value = repoId || null;
  await fetch("/api/repos/default", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo_id: value }),
  });
  setDefaultRepoId(value);
};
```

Add the Repositories card in JSX, between the AI Settings card and the Connectors card:

```tsx
<Card>
  <CardHeader>
    <CardTitle className="text-base">Repositories</CardTitle>
  </CardHeader>
  <CardContent className="space-y-4">
    {repos.length > 0 && (
      <div className="space-y-2">
        {repos.map((repo) => (
          <div key={repo.id} className="flex items-center justify-between py-2 border-b last:border-0">
            <div>
              <p className="text-sm font-medium">{repo.name}</p>
              <p className="text-xs text-muted-foreground font-mono">{repo.path}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => handleDeleteRepo(repo.id)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>
    )}

    <div className="space-y-2">
      <label className="text-sm font-medium">Add Repository</label>
      <div className="flex gap-2">
        <Input
          placeholder="Name"
          value={newRepoName}
          onChange={(e) => setNewRepoName(e.target.value)}
          className="flex-1"
        />
        <Input
          placeholder="/path/to/repo"
          value={newRepoPath}
          onChange={(e) => setNewRepoPath(e.target.value)}
          className="flex-[2]"
        />
        <Button size="sm" onClick={handleAddRepo}>Add</Button>
      </div>
    </div>

    {repos.length > 0 && (
      <div>
        <label className="text-sm font-medium">Default Repository</label>
        <select
          value={defaultRepoId || ""}
          onChange={(e) => handleSetDefaultRepo(e.target.value)}
          className="w-full mt-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">None</option>
          {repos.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </div>
    )}
  </CardContent>
</Card>
```

Add the `Trash2` import (should already exist from `lucide-react`).

**Step 2: Type-check**

Run: `cd client && npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add client/src/components/Settings.tsx
git commit -m "feat: add repos management to settings page"
```

---

### Task 12: Final verification

**Step 1: Run server tests**

Run: `cd server && npx vitest run`
Expected: All tests pass.

**Step 2: Type-check client**

Run: `cd client && npx tsc --noEmit`
Expected: No errors.

**Step 3: Type-check server**

Run: `cd server && npx tsc --noEmit`
Expected: Only the pre-existing "composite" error, nothing new.

**Step 4: Final commit if any remaining changes**

```bash
git add -A && git status
```
