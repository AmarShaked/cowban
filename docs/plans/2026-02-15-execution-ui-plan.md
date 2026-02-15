# Execution UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add persistent execution logs, Claude Code task tracking, plan checklists, and live interactive Q&A to the card detail panel.

**Architecture:** Switch Claude Code spawning from raw stdout to `--output-format stream-json` NDJSON parsing. Persist all events to a new `execution_logs` table. On `AskUserQuestion` detection, pause execution and resume via `--resume <session_id>`. Client fetches historical logs on panel open and renders todos/questions inline.

**Tech Stack:** SQLite (better-sqlite3), Express SSE, Claude Code CLI (`--output-format stream-json`, `--resume`), React, Vitest

---

### Task 1: DB Migration — execution_logs table

**Files:**
- Create: `server/src/db/migrations/002_execution_logs.sql`
- Modify: `server/src/db/migrate.ts:8-11`

**Step 1: Create the migration SQL file**

Create `server/src/db/migrations/002_execution_logs.sql`:

```sql
CREATE TABLE IF NOT EXISTS execution_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  session_id TEXT,
  step TEXT NOT NULL,
  message TEXT NOT NULL,
  data JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_execution_logs_card_id ON execution_logs(card_id);
```

**Step 2: Update migrate.ts to run the new migration**

In `server/src/db/migrate.ts`, add the second migration file read and exec right after the first:

```typescript
import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function migrate(db: Database.Database): void {
  const sql1 = readFileSync(join(__dirname, "migrations", "001_initial.sql"), "utf-8");
  db.exec(sql1);
  const sql2 = readFileSync(join(__dirname, "migrations", "002_execution_logs.sql"), "utf-8");
  db.exec(sql2);
}
```

**Step 3: Run existing tests to verify migration doesn't break anything**

Run: `cd server && npx vitest run src/db/__tests__/`
Expected: All existing tests pass (migration uses `CREATE TABLE IF NOT EXISTS`)

**Step 4: Commit**

```bash
git add server/src/db/migrations/002_execution_logs.sql server/src/db/migrate.ts
git commit -m "feat: add execution_logs table migration"
```

---

### Task 2: Shared Types — ExecutionLog, TodoItem, QuestionEvent

**Files:**
- Modify: `shared/src/types.ts`

**Step 1: Add the new types at the end of `shared/src/types.ts`**

Append after the existing `ToggleAiRequest` interface:

```typescript
export interface ExecutionLog {
  id: number;
  card_id: number;
  session_id: string | null;
  step: string;  // start, ai_output, question, answer, todo, done, error, executing, executed
  message: string;
  data: Record<string, unknown> | null;
  created_at: string;
}

export interface TodoItem {
  id: string;
  subject: string;
  status: "pending" | "in_progress" | "completed";
}

export interface QuestionEvent {
  questionId: number;  // execution_log id
  question: string;
  header?: string;
  options?: { label: string; description?: string }[];
  multiSelect?: boolean;
}
```

**Step 2: Commit**

```bash
git add shared/src/types.ts
git commit -m "feat: add ExecutionLog, TodoItem, QuestionEvent types"
```

---

### Task 3: LogRepo — Log persistence CRUD

**Files:**
- Create: `server/src/db/log-repo.ts`
- Create: `server/src/db/__tests__/log-repo.test.ts`

**Step 1: Write the failing test**

Create `server/src/db/__tests__/log-repo.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../migrate.js";
import { LogRepo } from "../log-repo.js";

describe("LogRepo", () => {
  let db: Database.Database;
  let repo: LogRepo;
  let cardId: number;

  beforeEach(() => {
    db = new Database(":memory:");
    migrate(db);
    const boardResult = db.prepare("INSERT INTO boards (date) VALUES ('2026-02-15')").run();
    const boardId = Number(boardResult.lastInsertRowid);
    const cardResult = db.prepare(
      "INSERT INTO cards (board_id, source_type, title) VALUES (?, 'manual', 'Test')"
    ).run(boardId);
    cardId = Number(cardResult.lastInsertRowid);
    repo = new LogRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  it("inserts a log and retrieves it", () => {
    repo.insert(cardId, "start", "Starting execution", null, null);
    const logs = repo.listByCard(cardId);
    expect(logs).toHaveLength(1);
    expect(logs[0].step).toBe("start");
    expect(logs[0].message).toBe("Starting execution");
    expect(logs[0].card_id).toBe(cardId);
  });

  it("inserts log with session_id and data", () => {
    repo.insert(cardId, "todo", "Implement feature", "sess-123", { id: "t1", subject: "Do thing", status: "pending" });
    const logs = repo.listByCard(cardId);
    expect(logs).toHaveLength(1);
    expect(logs[0].session_id).toBe("sess-123");
    expect(logs[0].data).toEqual({ id: "t1", subject: "Do thing", status: "pending" });
  });

  it("lists logs in chronological order", () => {
    repo.insert(cardId, "start", "First", null, null);
    repo.insert(cardId, "ai_output", "Second", null, null);
    repo.insert(cardId, "done", "Third", null, null);
    const logs = repo.listByCard(cardId);
    expect(logs).toHaveLength(3);
    expect(logs[0].step).toBe("start");
    expect(logs[2].step).toBe("done");
  });

  it("deletes logs for a card", () => {
    repo.insert(cardId, "start", "Starting", null, null);
    repo.insert(cardId, "done", "Done", null, null);
    repo.deleteByCard(cardId);
    const logs = repo.listByCard(cardId);
    expect(logs).toHaveLength(0);
  });

  it("returns empty array for card with no logs", () => {
    const logs = repo.listByCard(999);
    expect(logs).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/db/__tests__/log-repo.test.ts`
Expected: FAIL — cannot find module `../log-repo.js`

**Step 3: Write the implementation**

Create `server/src/db/log-repo.ts`:

```typescript
import Database from "better-sqlite3";
import type { ExecutionLog } from "@daily-kanban/shared";

function rowToLog(row: Record<string, unknown>): ExecutionLog {
  return {
    ...row,
    data: row.data ? JSON.parse(row.data as string) : null,
  } as ExecutionLog;
}

export class LogRepo {
  constructor(private db: Database.Database) {}

  insert(
    cardId: number,
    step: string,
    message: string,
    sessionId: string | null,
    data: Record<string, unknown> | null,
  ): ExecutionLog {
    const result = this.db
      .prepare(
        `INSERT INTO execution_logs (card_id, session_id, step, message, data)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(cardId, sessionId, step, message, data ? JSON.stringify(data) : null);

    return this.getById(Number(result.lastInsertRowid))!;
  }

  getById(id: number): ExecutionLog | null {
    const row = this.db.prepare("SELECT * FROM execution_logs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? rowToLog(row) : null;
  }

  listByCard(cardId: number): ExecutionLog[] {
    const rows = this.db
      .prepare("SELECT * FROM execution_logs WHERE card_id = ? ORDER BY created_at ASC, id ASC")
      .all(cardId) as Record<string, unknown>[];
    return rows.map(rowToLog);
  }

  deleteByCard(cardId: number): void {
    this.db.prepare("DELETE FROM execution_logs WHERE card_id = ?").run(cardId);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/db/__tests__/log-repo.test.ts`
Expected: All 5 tests PASS

**Step 5: Commit**

```bash
git add server/src/db/log-repo.ts server/src/db/__tests__/log-repo.test.ts
git commit -m "feat: add LogRepo for execution log persistence"
```

---

### Task 4: Stream-JSON Parser

**Files:**
- Create: `server/src/ai/stream-json-parser.ts`
- Create: `server/src/ai/__tests__/stream-json-parser.test.ts`

**Step 1: Write the failing test**

Create `server/src/ai/__tests__/stream-json-parser.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { StreamJsonParser, type ParsedEvent } from "../stream-json-parser.js";

describe("StreamJsonParser", () => {
  it("extracts text deltas", () => {
    const events: ParsedEvent[] = [];
    const parser = new StreamJsonParser((e) => events.push(e));

    parser.feed(JSON.stringify({
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" }
    }) + "\n");

    parser.feed(JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Hello world" }
    }) + "\n");

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "text", text: "Hello world" });
  });

  it("detects tool_use start for AskUserQuestion", () => {
    const events: ParsedEvent[] = [];
    const parser = new StreamJsonParser((e) => events.push(e));

    parser.feed(JSON.stringify({
      type: "content_block_start",
      index: 1,
      content_block: { type: "tool_use", id: "tool_1", name: "AskUserQuestion", input: {} }
    }) + "\n");

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("tool_use_start");
    if (events[0].type === "tool_use_start") {
      expect(events[0].toolName).toBe("AskUserQuestion");
    }
  });

  it("accumulates tool input JSON deltas", () => {
    const events: ParsedEvent[] = [];
    const parser = new StreamJsonParser((e) => events.push(e));

    parser.feed(JSON.stringify({
      type: "content_block_start",
      index: 1,
      content_block: { type: "tool_use", id: "tool_1", name: "TaskCreate", input: {} }
    }) + "\n");

    parser.feed(JSON.stringify({
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: '{"subject":' }
    }) + "\n");

    parser.feed(JSON.stringify({
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: '"Do thing"}' }
    }) + "\n");

    parser.feed(JSON.stringify({
      type: "content_block_stop",
      index: 1
    }) + "\n");

    const toolComplete = events.find(e => e.type === "tool_use_complete");
    expect(toolComplete).toBeDefined();
    if (toolComplete?.type === "tool_use_complete") {
      expect(toolComplete.toolName).toBe("TaskCreate");
      expect(toolComplete.input).toEqual({ subject: "Do thing" });
    }
  });

  it("captures session_id from init message", () => {
    const events: ParsedEvent[] = [];
    const parser = new StreamJsonParser((e) => events.push(e));

    parser.feed(JSON.stringify({
      type: "init",
      session_id: "abc-123"
    }) + "\n");

    const initEvent = events.find(e => e.type === "init");
    expect(initEvent).toBeDefined();
    if (initEvent?.type === "init") {
      expect(initEvent.sessionId).toBe("abc-123");
    }
  });

  it("captures result event", () => {
    const events: ParsedEvent[] = [];
    const parser = new StreamJsonParser((e) => events.push(e));

    parser.feed(JSON.stringify({
      type: "result",
      status: "success",
      duration_ms: 5000,
      session_id: "abc-123"
    }) + "\n");

    const result = events.find(e => e.type === "result");
    expect(result).toBeDefined();
    if (result?.type === "result") {
      expect(result.status).toBe("success");
      expect(result.sessionId).toBe("abc-123");
    }
  });

  it("handles multiple lines in a single feed", () => {
    const events: ParsedEvent[] = [];
    const parser = new StreamJsonParser((e) => events.push(e));

    const lines = [
      JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
      JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "A" } }),
      JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "B" } }),
    ].join("\n") + "\n";

    parser.feed(lines);
    expect(events.filter(e => e.type === "text")).toHaveLength(2);
  });

  it("handles partial lines across feeds (buffering)", () => {
    const events: ParsedEvent[] = [];
    const parser = new StreamJsonParser((e) => events.push(e));

    const full = JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } });
    // Split in the middle
    parser.feed(full.slice(0, 20));
    expect(events).toHaveLength(0);
    parser.feed(full.slice(20) + "\n");
    expect(events).toHaveLength(1);
  });

  it("ignores malformed JSON lines", () => {
    const events: ParsedEvent[] = [];
    const parser = new StreamJsonParser((e) => events.push(e));

    parser.feed("not json\n");
    parser.feed("{broken\n");
    expect(events).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/ai/__tests__/stream-json-parser.test.ts`
Expected: FAIL — cannot find module

**Step 3: Write the implementation**

Create `server/src/ai/stream-json-parser.ts`:

```typescript
export type ParsedEvent =
  | { type: "init"; sessionId: string }
  | { type: "text"; text: string }
  | { type: "tool_use_start"; toolName: string; toolId: string; index: number }
  | { type: "tool_use_complete"; toolName: string; toolId: string; input: Record<string, unknown> }
  | { type: "result"; status: string; sessionId?: string; durationMs?: number };

interface ToolAccumulator {
  name: string;
  id: string;
  index: number;
  jsonChunks: string[];
}

export class StreamJsonParser {
  private buffer = "";
  private activeTools = new Map<number, ToolAccumulator>();

  constructor(private onEvent: (event: ParsedEvent) => void) {}

  feed(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    // Keep the last (possibly incomplete) line in the buffer
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed);
        this.processObject(obj);
      } catch {
        // Skip malformed JSON
      }
    }
  }

  private processObject(obj: Record<string, unknown>): void {
    const type = obj.type as string;

    if (type === "init") {
      this.onEvent({ type: "init", sessionId: obj.session_id as string });
      return;
    }

    if (type === "result") {
      this.onEvent({
        type: "result",
        status: obj.status as string,
        sessionId: obj.session_id as string | undefined,
        durationMs: obj.duration_ms as number | undefined,
      });
      return;
    }

    if (type === "content_block_start") {
      const block = obj.content_block as Record<string, unknown>;
      if (block?.type === "tool_use") {
        const index = obj.index as number;
        const toolName = block.name as string;
        const toolId = block.id as string;
        this.activeTools.set(index, { name: toolName, id: toolId, index, jsonChunks: [] });
        this.onEvent({ type: "tool_use_start", toolName, toolId, index });
      }
      return;
    }

    if (type === "content_block_delta") {
      const delta = obj.delta as Record<string, unknown>;
      if (delta?.type === "text_delta") {
        this.onEvent({ type: "text", text: delta.text as string });
      } else if (delta?.type === "input_json_delta") {
        const index = obj.index as number;
        const tool = this.activeTools.get(index);
        if (tool) {
          tool.jsonChunks.push(delta.partial_json as string);
        }
      }
      return;
    }

    if (type === "content_block_stop") {
      const index = obj.index as number;
      const tool = this.activeTools.get(index);
      if (tool) {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(tool.jsonChunks.join(""));
        } catch {
          // Malformed tool input
        }
        this.onEvent({ type: "tool_use_complete", toolName: tool.name, toolId: tool.id, input });
        this.activeTools.delete(index);
      }
      return;
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/ai/__tests__/stream-json-parser.test.ts`
Expected: All 8 tests PASS

**Step 5: Commit**

```bash
git add server/src/ai/stream-json-parser.ts server/src/ai/__tests__/stream-json-parser.test.ts
git commit -m "feat: add StreamJsonParser for Claude Code NDJSON output"
```

---

### Task 5: ClaudeEvaluator — executeWithStreamJson method

**Files:**
- Modify: `server/src/ai/claude-evaluator.ts`

**Step 1: Add the new method to ClaudeEvaluator**

Add this method to the `ClaudeEvaluator` class in `server/src/ai/claude-evaluator.ts`, after the existing `generatePlanStream` method (around line 216). Also add the import for `StreamJsonParser` and its types at the top.

Add import at top of file (after existing imports):

```typescript
import { StreamJsonParser, type ParsedEvent } from "./stream-json-parser.js";
```

Add export interface before the class:

```typescript
export interface ExecutionCallbacks {
  onText: (text: string) => void;
  onToolStart: (toolName: string) => void;
  onToolComplete: (toolName: string, input: Record<string, unknown>) => void;
  onInit: (sessionId: string) => void;
  onResult: (status: string, sessionId?: string) => void;
}
```

Add method to the class:

```typescript
  executeWithStreamJson(
    prompt: string,
    cwd: string,
    callbacks: ExecutionCallbacks,
    sessionId?: string,
  ): { child: import("child_process").ChildProcess; promise: Promise<void> } {
    const args = sessionId
      ? ["--resume", sessionId, "-p", prompt, "--output-format", "stream-json"]
      : ["-p", prompt, "--output-format", "stream-json", "--allowedTools", "Bash,Read,Write,Edit,Glob,Grep"];

    const child = spawn("claude", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 300000,
    });

    const parser = new StreamJsonParser((event: ParsedEvent) => {
      switch (event.type) {
        case "init":
          callbacks.onInit(event.sessionId);
          break;
        case "text":
          callbacks.onText(event.text);
          break;
        case "tool_use_start":
          callbacks.onToolStart(event.toolName);
          break;
        case "tool_use_complete":
          callbacks.onToolComplete(event.toolName, event.input);
          break;
        case "result":
          callbacks.onResult(event.status, event.sessionId);
          break;
      }
    });

    child.stdout!.on("data", (data: Buffer) => {
      parser.feed(data.toString());
    });

    child.stderr!.on("data", (data: Buffer) => {
      console.error("Claude execute stderr:", data.toString());
    });

    const promise = new Promise<void>((resolve) => {
      child.on("close", () => resolve());
      child.on("error", (err) => {
        console.error("Claude execute spawn error:", err);
        resolve();
      });
    });

    return { child, promise };
  }
```

**Step 2: Run existing evaluator tests to ensure nothing breaks**

Run: `cd server && npx vitest run src/ai/__tests__/claude-evaluator.test.ts`
Expected: All existing tests PASS

**Step 3: Commit**

```bash
git add server/src/ai/claude-evaluator.ts
git commit -m "feat: add executeWithStreamJson method to ClaudeEvaluator"
```

---

### Task 6: Server Routes — Wire up LogRepo, update execute-code, add /logs and /answer

**Files:**
- Modify: `server/src/routes/ai.ts`
- Modify: `server/src/index.ts:31` (add LogRepo initialization)

**Step 1: Add LogRepo to index.ts**

In `server/src/index.ts`, add import and initialization after the existing repo setup:

After line 7 (the SettingsRepo import), add:
```typescript
import { LogRepo } from "./db/log-repo.js";
```

After line 32 (`const settingsRepo = ...`), add:
```typescript
const logRepo = new LogRepo(db);
```

Update line 68 (the createAiRouter call) to pass logRepo:
```typescript
app.use("/api/ai", createAiRouter(cardRepo, evaluator, registry, db, settingsRepo, logRepo));
```

**Step 2: Rewrite the execute-code endpoint and add new endpoints**

Replace the `createAiRouter` function signature in `server/src/routes/ai.ts` to accept `LogRepo`:

Add import at top:
```typescript
import type { LogRepo } from "../db/log-repo.js";
import type { TodoItem, QuestionEvent } from "@daily-kanban/shared";
```

Update function signature:
```typescript
export function createAiRouter(
  cardRepo: CardRepo,
  evaluator: ClaudeEvaluator,
  registry: ConnectorRegistry,
  db: Database.Database,
  settingsRepo: SettingsRepo,
  logRepo: LogRepo,
  confidenceThreshold: number = 80
): Router {
```

Add `GET /logs/:cardId` endpoint right after the router creation:

```typescript
  router.get("/logs/:cardId", (req, res) => {
    const cardId = Number(req.params.cardId);
    const logs = logRepo.listByCard(cardId);
    res.json({ logs });
  });
```

Replace the entire `router.post("/execute-code/:cardId", ...)` handler (lines 215-324) with this new version that uses stream-json parsing, persists logs, handles questions, and tracks todos:

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

    // Clear any previous logs for this card before new execution
    logRepo.deleteByCard(cardId);
    cardRepo.setMetadataField(cardId, "execution_status", "running");

    const persistAndSend = (step: string, message: string, sessionId: string | null, data: Record<string, unknown> | null, extra?: Record<string, unknown>) => {
      logRepo.insert(cardId, step, message, sessionId, data);
      send({ step, message, ...extra, ...(data ? { data } : {}) });
    };

    try {
      persistAndSend("start", "Starting code execution...", null, null);
      persistAndSend("executing", `Running Claude Code in ${repo.name}...`, null, null);

      const plan = card.body || "";
      const prompt = `Execute this implementation plan in the current repository.\n\nPlan:\n${plan}\n\nImplement all changes described. Run tests if applicable.`;

      // Existing session (for resume after question)
      const existingSessionId = card.metadata?.session_id as string | undefined;
      let currentSessionId = existingSessionId || null;
      let textBuffer = "";
      let paused = false;

      const { child, promise } = evaluator.executeWithStreamJson(
        prompt,
        worktreePath,
        {
          onInit: (sessionId) => {
            currentSessionId = sessionId;
            cardRepo.setMetadataField(cardId, "session_id", sessionId);
          },
          onText: (text) => {
            textBuffer += text;
            // Flush text in chunks to avoid too many log rows
            if (textBuffer.length > 200 || text.includes("\n")) {
              persistAndSend("ai_output", textBuffer, currentSessionId, null);
              textBuffer = "";
            }
          },
          onToolStart: (toolName) => {
            if (toolName === "AskUserQuestion") {
              // Question coming — we'll handle on complete
            }
          },
          onToolComplete: (toolName, input) => {
            if (toolName === "TaskCreate" || toolName === "TaskUpdate") {
              const todoData: Record<string, unknown> = {
                id: input.subject || input.taskId || "unknown",
                subject: (input as Record<string, unknown>).subject as string || "Task",
                status: (input as Record<string, unknown>).status as string || "pending",
              };
              persistAndSend("todo", `Task: ${todoData.subject}`, currentSessionId, todoData);
            } else if (toolName === "AskUserQuestion") {
              // Flush remaining text
              if (textBuffer) {
                persistAndSend("ai_output", textBuffer, currentSessionId, null);
                textBuffer = "";
              }

              // Extract question from the AskUserQuestion input
              const questions = (input.questions as Array<Record<string, unknown>>) || [];
              const firstQ = questions[0] || {};
              const questionData: Record<string, unknown> = {
                question: firstQ.question || "Claude needs your input",
                header: firstQ.header || "",
                options: firstQ.options || [],
                multiSelect: firstQ.multiSelect || false,
              };

              const logEntry = logRepo.insert(cardId, "question", questionData.question as string, currentSessionId, questionData);
              send({ step: "question", message: questionData.question as string, data: { ...questionData, questionId: logEntry.id } });

              cardRepo.setMetadataField(cardId, "execution_status", "paused_question");
              paused = true;
              child.kill("SIGTERM");
            }
          },
          onResult: (status, sessionId) => {
            if (sessionId) {
              currentSessionId = sessionId;
              cardRepo.setMetadataField(cardId, "session_id", sessionId);
            }
          },
        },
        existingSessionId,
      );

      await promise;

      // Flush remaining text buffer
      if (textBuffer) {
        persistAndSend("ai_output", textBuffer, currentSessionId, null);
        textBuffer = "";
      }

      if (paused) {
        // We killed the process for a question — end SSE, wait for answer
        res.end();
        return;
      }

      // Normal completion — commit, PR, cleanup
      persistAndSend("executing", "Committing changes...", currentSessionId, null);
      await worktreeManager.commit(worktreePath, `feat: ${card.title}`);

      persistAndSend("executing", "Creating pull request...", currentSessionId, null);
      let prUrl = "";
      try {
        prUrl = await worktreeManager.createPR(
          worktreePath,
          card.title,
          `## Summary\n\n${card.proposed_action}\n\n## Plan\n\n${plan}\n\n---\nGenerated by Daily Kanban AI`,
        );
        persistAndSend("executed", `PR created: ${prUrl}`, currentSessionId, null);
      } catch (err) {
        persistAndSend("error", `PR creation failed: ${(err as Error).message}`, currentSessionId, null);
      }

      persistAndSend("executing", "Cleaning up worktree...", currentSessionId, null);
      await worktreeManager.remove(worktreePath);
      cardRepo.setMetadataField(cardId, "worktree_path", null);

      cardRepo.setExecutionResult(cardId, prUrl ? `PR: ${prUrl}` : "Code changes committed");
      cardRepo.moveToColumn(cardId, "done");
      cardRepo.setMetadataField(cardId, "execution_status", "completed");

      const updated = cardRepo.getById(cardId);
      persistAndSend("done", prUrl ? `Done! PR: ${prUrl}` : "Done!", currentSessionId, null, { card: updated });
    } catch (err) {
      console.error("Execute-code error:", err);
      cardRepo.setMetadataField(cardId, "execution_status", "failed");
      persistAndSend("error", "Code execution failed", null, null);
      persistAndSend("done", "Execution failed", null, null, { card: cardRepo.getById(cardId) });
    }

    res.end();
  });
```

Add the `POST /answer/:cardId` endpoint right after the execute-code handler:

```typescript
  router.post("/answer/:cardId", async (req, res) => {
    const cardId = Number(req.params.cardId);
    const card = cardRepo.getById(cardId);
    const { answer } = req.body as { answer: string };

    if (!card) {
      res.status(404).json({ error: "Card not found" });
      return;
    }

    const sessionId = card.metadata?.session_id as string | undefined;
    if (!sessionId) {
      res.status(400).json({ error: "No active session to resume" });
      return;
    }

    const worktreePath = card.metadata?.worktree_path as string | undefined;
    const repoId = card.metadata?.repo_id as string | undefined;
    if (!worktreePath || !repoId) {
      res.status(400).json({ error: "Card has no worktree or repo" });
      return;
    }

    const repos = settingsRepo.get<{ id: string; name: string; path: string }[]>("repos", []);
    const repo = repos.find((r) => r.id === repoId);
    if (!repo) {
      res.status(400).json({ error: "Assigned repo not found" });
      return;
    }

    // Persist the answer
    logRepo.insert(cardId, "answer", answer, sessionId, null);

    // SSE setup — resuming execution
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const send = (data: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    cardRepo.setMetadataField(cardId, "execution_status", "running");

    const persistAndSend = (step: string, message: string, sid: string | null, data: Record<string, unknown> | null, extra?: Record<string, unknown>) => {
      logRepo.insert(cardId, step, message, sid, data);
      send({ step, message, ...extra, ...(data ? { data } : {}) });
    };

    try {
      persistAndSend("start", `Resuming with answer: "${answer}"`, sessionId, null);

      let currentSessionId = sessionId;
      let textBuffer = "";
      let paused = false;

      const { child, promise } = evaluator.executeWithStreamJson(
        answer,
        worktreePath,
        {
          onInit: (sid) => {
            currentSessionId = sid;
            cardRepo.setMetadataField(cardId, "session_id", sid);
          },
          onText: (text) => {
            textBuffer += text;
            if (textBuffer.length > 200 || text.includes("\n")) {
              persistAndSend("ai_output", textBuffer, currentSessionId, null);
              textBuffer = "";
            }
          },
          onToolStart: () => {},
          onToolComplete: (toolName, input) => {
            if (toolName === "TaskCreate" || toolName === "TaskUpdate") {
              const todoData: Record<string, unknown> = {
                id: input.subject || input.taskId || "unknown",
                subject: (input as Record<string, unknown>).subject as string || "Task",
                status: (input as Record<string, unknown>).status as string || "pending",
              };
              persistAndSend("todo", `Task: ${todoData.subject}`, currentSessionId, todoData);
            } else if (toolName === "AskUserQuestion") {
              if (textBuffer) {
                persistAndSend("ai_output", textBuffer, currentSessionId, null);
                textBuffer = "";
              }
              const questions = (input.questions as Array<Record<string, unknown>>) || [];
              const firstQ = questions[0] || {};
              const questionData: Record<string, unknown> = {
                question: firstQ.question || "Claude needs your input",
                header: firstQ.header || "",
                options: firstQ.options || [],
                multiSelect: firstQ.multiSelect || false,
              };
              const logEntry = logRepo.insert(cardId, "question", questionData.question as string, currentSessionId, questionData);
              send({ step: "question", message: questionData.question as string, data: { ...questionData, questionId: logEntry.id } });
              cardRepo.setMetadataField(cardId, "execution_status", "paused_question");
              paused = true;
              child.kill("SIGTERM");
            }
          },
          onResult: (status, sid) => {
            if (sid) {
              currentSessionId = sid;
              cardRepo.setMetadataField(cardId, "session_id", sid);
            }
          },
        },
        sessionId,
      );

      await promise;

      if (textBuffer) {
        persistAndSend("ai_output", textBuffer, currentSessionId, null);
      }

      if (paused) {
        res.end();
        return;
      }

      // Normal completion
      persistAndSend("executing", "Committing changes...", currentSessionId, null);
      await worktreeManager.commit(worktreePath, `feat: ${card.title}`);

      persistAndSend("executing", "Creating pull request...", currentSessionId, null);
      let prUrl = "";
      try {
        prUrl = await worktreeManager.createPR(
          worktreePath,
          card.title,
          `## Summary\n\n${card.proposed_action}\n\n## Plan\n\n${card.body || ""}\n\n---\nGenerated by Daily Kanban AI`,
        );
        persistAndSend("executed", `PR created: ${prUrl}`, currentSessionId, null);
      } catch (err) {
        persistAndSend("error", `PR creation failed: ${(err as Error).message}`, currentSessionId, null);
      }

      persistAndSend("executing", "Cleaning up worktree...", currentSessionId, null);
      await worktreeManager.remove(worktreePath);
      cardRepo.setMetadataField(cardId, "worktree_path", null);

      cardRepo.setExecutionResult(cardId, prUrl ? `PR: ${prUrl}` : "Code changes committed");
      cardRepo.moveToColumn(cardId, "done");
      cardRepo.setMetadataField(cardId, "execution_status", "completed");

      const updated = cardRepo.getById(cardId);
      persistAndSend("done", prUrl ? `Done! PR: ${prUrl}` : "Done!", currentSessionId, null, { card: updated });
    } catch (err) {
      console.error("Answer/resume error:", err);
      cardRepo.setMetadataField(cardId, "execution_status", "failed");
      persistAndSend("error", "Execution failed after resume", null, null);
      persistAndSend("done", "Execution failed", null, null, { card: cardRepo.getById(cardId) });
    }

    res.end();
  });
```

**Step 3: Run all server tests**

Run: `cd server && npx vitest run`
Expected: All existing tests still pass

**Step 4: Commit**

```bash
git add server/src/routes/ai.ts server/src/index.ts
git commit -m "feat: wire LogRepo, update execute-code with stream-json, add /logs and /answer endpoints"
```

---

### Task 7: Client API — Add new endpoints

**Files:**
- Modify: `client/src/lib/api.ts`

**Step 1: Add the three new API methods**

Add these methods to the `api` object in `client/src/lib/api.ts`, after the existing `processCardStream` method:

```typescript
  getExecutionLogs: (cardId: number) =>
    fetchJson<{ logs: import("@daily-kanban/shared").ExecutionLog[] }>(`/ai/logs/${cardId}`),

  answerQuestion: (
    cardId: number,
    answer: string,
    onEvent: (event: { step: string; message: string; card?: Card; data?: Record<string, unknown> }) => void,
  ): { abort: () => void } => {
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch(`${BASE}/ai/answer/${cardId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answer }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          onEvent({ step: "error", message: `API error: ${res.status}` });
          onEvent({ step: "done", message: "Resume failed" });
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
                // Skip malformed
              }
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          onEvent({ step: "error", message: "Connection failed" });
          onEvent({ step: "done", message: "Resume failed" });
        }
      }
    })();

    return { abort: () => controller.abort() };
  },
```

**Step 2: Commit**

```bash
git add client/src/lib/api.ts
git commit -m "feat: add getExecutionLogs and answerQuestion API methods"
```

---

### Task 8: useAiProcessing Hook — Handle questions, todos, persisted logs

**Files:**
- Modify: `client/src/hooks/useAiProcessing.ts`

**Step 1: Rewrite the hook to handle the new event types**

Replace the entire contents of `client/src/hooks/useAiProcessing.ts`:

```typescript
import { useState, useRef, useCallback } from "react";
import type { Card, TodoItem, QuestionEvent, ExecutionLog } from "@daily-kanban/shared";
import { api } from "../lib/api";

export interface ProcessingLog {
  step: string;
  message: string;
  data?: Record<string, unknown>;
}

export function useAiProcessing() {
  const [processingCardId, setProcessingCardId] = useState<number | null>(null);
  const [logs, setLogs] = useState<ProcessingLog[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [activeQuestion, setActiveQuestion] = useState<QuestionEvent | null>(null);
  const abortRef = useRef<{ abort: () => void } | null>(null);

  const handleEvent = useCallback(
    (event: { step: string; message: string; card?: Card; data?: Record<string, unknown> }, onCardUpdate: (card: Card) => void) => {
      setLogs((prev) => [...prev, { step: event.step, message: event.message, data: event.data }]);

      if (event.step === "todo" && event.data) {
        const todoData = event.data as unknown as TodoItem;
        setTodos((prev) => {
          const idx = prev.findIndex((t) => t.id === todoData.id);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = todoData;
            return updated;
          }
          return [...prev, todoData];
        });
      }

      if (event.step === "question" && event.data) {
        setActiveQuestion({
          questionId: event.data.questionId as number,
          question: event.message,
          header: event.data.header as string | undefined,
          options: event.data.options as QuestionEvent["options"],
          multiSelect: event.data.multiSelect as boolean | undefined,
        });
      }

      if (event.step === "done" && event.card) {
        onCardUpdate(event.card);
        setProcessingCardId(null);
        setActiveQuestion(null);
      }
    },
    [],
  );

  const startProcessing = useCallback(
    (cardId: number, onCardUpdate: (card: Card) => void, customRequest?: string) => {
      abortRef.current?.abort();

      setProcessingCardId(cardId);
      setLogs([]);
      setTodos([]);
      setActiveQuestion(null);

      const handle = api.processCardStream(cardId, (event) => {
        handleEvent(event, onCardUpdate);
      }, customRequest);

      abortRef.current = handle;
    },
    [handleEvent],
  );

  const startExecution = useCallback(
    (cardId: number, onCardUpdate: (card: Card) => void) => {
      abortRef.current?.abort();

      setProcessingCardId(cardId);
      setLogs([]);
      setTodos([]);
      setActiveQuestion(null);

      const handle = api.executeCodeStream(cardId, (event) => {
        handleEvent(event, onCardUpdate);
      });

      abortRef.current = handle;
    },
    [handleEvent],
  );

  const answerQuestion = useCallback(
    (cardId: number, answer: string, onCardUpdate: (card: Card) => void) => {
      setActiveQuestion(null);
      setLogs((prev) => [...prev, { step: "answer", message: answer }]);

      const handle = api.answerQuestion(cardId, answer, (event) => {
        handleEvent(event, onCardUpdate);
      });

      abortRef.current = handle;
    },
    [handleEvent],
  );

  const loadHistoricalLogs = useCallback(async (cardId: number) => {
    try {
      const { logs: historicalLogs } = await api.getExecutionLogs(cardId);
      const mapped: ProcessingLog[] = historicalLogs.map((l) => ({
        step: l.step,
        message: l.message,
        data: l.data || undefined,
      }));
      setLogs(mapped);

      // Extract todos from historical logs
      const todoLogs = historicalLogs.filter((l) => l.step === "todo" && l.data);
      const todoItems: TodoItem[] = todoLogs.map((l) => l.data as unknown as TodoItem);
      setTodos(todoItems);

      // Check for unanswered question
      const questionLogs = historicalLogs.filter((l) => l.step === "question");
      const answerLogs = historicalLogs.filter((l) => l.step === "answer");
      if (questionLogs.length > answerLogs.length) {
        const lastQuestion = questionLogs[questionLogs.length - 1];
        if (lastQuestion.data) {
          setActiveQuestion({
            questionId: lastQuestion.id,
            question: lastQuestion.message,
            header: lastQuestion.data.header as string | undefined,
            options: lastQuestion.data.options as QuestionEvent["options"],
            multiSelect: lastQuestion.data.multiSelect as boolean | undefined,
          });
        }
      }
    } catch (err) {
      console.error("Failed to load historical logs:", err);
    }
  }, []);

  return {
    processingCardId,
    logs,
    todos,
    activeQuestion,
    startProcessing,
    startExecution,
    answerQuestion,
    loadHistoricalLogs,
  };
}
```

**Step 2: Commit**

```bash
git add client/src/hooks/useAiProcessing.ts
git commit -m "feat: add todos, question handling, and historical logs to useAiProcessing"
```

---

### Task 9: CardDetailPanel — Logs Viewer, TODO Section, Q&A Interface

**Files:**
- Modify: `client/src/components/CardDetailPanel.tsx`
- Modify: `client/src/components/Board.tsx`

**Step 1: Update Board.tsx to pass new props**

In `client/src/components/Board.tsx`:

Update the destructured hook return (line 31) to include new values:
```typescript
  const { processingCardId, logs, todos, activeQuestion, startProcessing, startExecution, answerQuestion, loadHistoricalLogs } = useAiProcessing();
```

Add useEffect to load historical logs when a card is selected (after line 41):
```typescript
  useEffect(() => {
    if (currentSelectedCard && processingCardId !== currentSelectedCard.id) {
      loadHistoricalLogs(currentSelectedCard.id);
    }
  }, [currentSelectedCard?.id, processingCardId, loadHistoricalLogs]);
```

Update the CardDetailPanel usage (around line 162) to pass the new props:
```typescript
        {currentSelectedCard && (
          <CardDetailPanel
            card={currentSelectedCard}
            onClose={() => setSelectedCard(null)}
            processingLogs={processingCardId === currentSelectedCard.id ? logs : logs}
            todos={processingCardId === currentSelectedCard.id ? todos : todos}
            activeQuestion={processingCardId === currentSelectedCard.id ? activeQuestion : activeQuestion}
            isLiveProcessing={processingCardId === currentSelectedCard.id}
            onProcess={(customRequest) => startProcessing(currentSelectedCard.id, updateCard, customRequest)}
            onExecuteCode={() => startExecution(currentSelectedCard.id, updateCard)}
            onAnswerQuestion={(answer) => answerQuestion(currentSelectedCard.id, answer, updateCard)}
            repos={repos}
            defaultRepoId={defaultRepoId}
            onRepoChange={(repoId) => handleRepoChange(currentSelectedCard.id, repoId)}
          />
        )}
```

**Step 2: Rewrite CardDetailPanel.tsx**

Replace the entire contents of `client/src/components/CardDetailPanel.tsx`:

```tsx
import { useState, useRef, useCallback, useEffect } from "react";
import type { Card, TodoItem, QuestionEvent } from "@daily-kanban/shared";
import Markdown from "react-markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  X, Mail, Calendar, GitMerge, Send, ListTodo, PenLine, ExternalLink,
  Loader2, CheckCircle2, AlertTriangle, Sparkles, ChevronDown, ChevronRight,
  MessageCircleQuestion, CircleDot, Circle, CheckCircle,
} from "lucide-react";

const sourceIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  gmail: Mail,
  calendar: Calendar,
  linear: ListTodo,
  gitlab: GitMerge,
  telegram: Send,
  manual: PenLine,
};

const sourceLabels: Record<string, string> = {
  gmail: "Gmail",
  calendar: "Calendar",
  linear: "Linear",
  gitlab: "GitLab",
  telegram: "Telegram",
  manual: "Manual",
};

export interface ProcessingLog {
  step: string;
  message: string;
  data?: Record<string, unknown>;
}

interface CardDetailPanelProps {
  card: Card;
  onClose: () => void;
  processingLogs?: ProcessingLog[];
  todos?: TodoItem[];
  activeQuestion?: QuestionEvent | null;
  isLiveProcessing?: boolean;
  onProcess?: (customRequest?: string) => void;
  onExecuteCode?: () => void;
  onAnswerQuestion?: (answer: string) => void;
  repos?: { id: string; name: string; path: string }[];
  defaultRepoId?: string | null;
  onRepoChange?: (repoId: string) => void;
}

export function CardDetailPanel({
  card, onClose, processingLogs, todos, activeQuestion, isLiveProcessing,
  onProcess, onExecuteCode, onAnswerQuestion, repos, defaultRepoId, onRepoChange,
}: CardDetailPanelProps) {
  const Icon = sourceIcons[card.source_type] || PenLine;
  const externalUrl = card.metadata?.url as string | undefined;

  const [customRequest, setCustomRequest] = useState("");
  const [answerText, setAnswerText] = useState("");
  const [width, setWidth] = useState(400);
  const [logsExpanded, setLogsExpanded] = useState(true);
  const [todosExpanded, setTodosExpanded] = useState(true);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [processingLogs?.length]);

  const onResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;

    const onMove = (ev: PointerEvent) => {
      if (!dragging.current) return;
      const delta = startX.current - ev.clientX;
      const newWidth = Math.min(Math.max(startWidth.current + delta, 300), 800);
      setWidth(newWidth);
    };

    const onUp = () => {
      dragging.current = false;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }, [width]);

  const isProcessing = isLiveProcessing && processingLogs && processingLogs.length > 0 && !processingLogs.some(l => l.step === "done");
  const hasLogs = processingLogs && processingLogs.length > 0;
  const hasTodos = todos && todos.length > 0;
  const executionStatus = card.metadata?.execution_status as string | undefined;

  // Parse markdown checklists from card.body
  const planChecklist = parsePlanChecklist(card.body);

  return (
    <div
      className="absolute right-0 top-0 bottom-0 flex bg-background border-l shadow-xl z-10"
      style={{ width }}
    >
      {/* Resize handle */}
      <div
        className="w-1.5 cursor-col-resize hover:bg-accent/50 active:bg-accent shrink-0"
        onPointerDown={onResizePointerDown}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2 min-w-0">
            <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-xs text-muted-foreground">{sourceLabels[card.source_type] || card.source_type}</span>
            {card.confidence !== null && (
              <Badge variant={card.confidence >= 80 ? "default" : "secondary"}>
                {card.confidence}%
              </Badge>
            )}
            {executionStatus && (
              <Badge variant={executionStatus === "paused_question" ? "destructive" : executionStatus === "running" ? "default" : "secondary"}>
                {executionStatus.replace("_", " ")}
              </Badge>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">{card.title}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-muted-foreground capitalize">{card.column_name.replace("_", " ")}</span>
              <span className="text-xs text-muted-foreground">
                {new Date(card.created_at).toLocaleString()}
              </span>
            </div>
          </div>

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

          {/* Plan Checklists */}
          {planChecklist.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-2">Plan Checklist</h3>
              <div className="space-y-1">
                {planChecklist.map((item, i) => (
                  <label key={i} className="flex items-start gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={item.checked}
                      className="mt-0.5 rounded"
                      readOnly
                    />
                    <span className={item.checked ? "line-through text-muted-foreground" : ""}>{item.text}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {onProcess && (
            <div>
              <h3 className="text-sm font-medium mb-1">AI Request</h3>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  onProcess(customRequest || undefined);
                  setCustomRequest("");
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  value={customRequest}
                  onChange={(e) => setCustomRequest(e.target.value)}
                  placeholder="e.g. delete this email, close the issue..."
                  disabled={isProcessing}
                  className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                />
                <Button type="submit" size="sm" disabled={isProcessing}>
                  <Sparkles className="h-3 w-3 mr-1" />
                  Run
                </Button>
              </form>
            </div>
          )}

          {card.proposed_action && (
            <div>
              <h3 className="text-sm font-medium mb-1">AI Proposed Action</h3>
              <p className="text-sm text-blue-600 dark:text-blue-400">{card.proposed_action}</p>
            </div>
          )}

          {card.column_name === "review" && card.metadata?.repo_id && onExecuteCode && !isProcessing && (
            <Button onClick={onExecuteCode} className="w-full">
              Execute Code Changes
            </Button>
          )}

          {card.execution_result && (
            <div>
              <h3 className="text-sm font-medium mb-1">Execution Result</h3>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{card.execution_result}</p>
            </div>
          )}

          {/* Claude Tasks (TODOs) */}
          {hasTodos && (
            <div>
              <button
                onClick={() => setTodosExpanded(!todosExpanded)}
                className="flex items-center gap-1 text-sm font-medium mb-2 hover:text-foreground"
              >
                {todosExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                Tasks ({todos!.length})
              </button>
              {todosExpanded && (
                <div className="space-y-1.5">
                  {todos!.map((todo, i) => (
                    <div key={todo.id || i} className="flex items-center gap-2 text-sm">
                      <TodoStatusIcon status={todo.status} />
                      <span className={todo.status === "completed" ? "line-through text-muted-foreground" : ""}>
                        {todo.subject}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Active Question (Q&A) */}
          {activeQuestion && onAnswerQuestion && (
            <div className="rounded-lg border-2 border-amber-500/50 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-3">
              <div className="flex items-start gap-2">
                <MessageCircleQuestion className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <div>
                  {activeQuestion.header && (
                    <span className="text-xs font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wide">{activeQuestion.header}</span>
                  )}
                  <p className="text-sm font-medium">{activeQuestion.question}</p>
                </div>
              </div>

              {activeQuestion.options && activeQuestion.options.length > 0 && (
                <div className="space-y-1.5 pl-6">
                  {activeQuestion.options.map((opt, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        onAnswerQuestion(opt.label);
                        setAnswerText("");
                      }}
                      className="w-full text-left rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                    >
                      <span className="font-medium">{opt.label}</span>
                      {opt.description && <span className="text-muted-foreground ml-1">— {opt.description}</span>}
                    </button>
                  ))}
                </div>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (answerText.trim()) {
                    onAnswerQuestion(answerText.trim());
                    setAnswerText("");
                  }
                }}
                className="flex gap-2 pl-6"
              >
                <input
                  type="text"
                  value={answerText}
                  onChange={(e) => setAnswerText(e.target.value)}
                  placeholder="Type a custom answer..."
                  className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <Button type="submit" size="sm" disabled={!answerText.trim()}>
                  Send
                </Button>
              </form>
            </div>
          )}

          {/* Execution Logs */}
          {hasLogs && (
            <div>
              <button
                onClick={() => setLogsExpanded(!logsExpanded)}
                className="flex items-center gap-1 text-sm font-medium mb-2 hover:text-foreground"
              >
                {logsExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                Execution Logs
                {isProcessing && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-1" />}
              </button>
              {logsExpanded && (
                <div className="space-y-1.5 text-xs">
                  {processingLogs!.map((log, i) => (
                    <LogEntry key={i} log={log} />
                  ))}
                  <div ref={logsEndRef} />
                </div>
              )}
            </div>
          )}

          {card.metadata && Object.keys(card.metadata).length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-1">Details</h3>
              <dl className="text-sm space-y-1">
                {Object.entries(card.metadata).map(([key, value]) => {
                  if (["url", "repo_id", "worktree_path", "branch_name", "session_id", "execution_status"].includes(key)) return null;
                  return (
                    <div key={key} className="flex gap-2">
                      <dt className="text-muted-foreground capitalize">{key.replace(/_/g, " ")}:</dt>
                      <dd className="break-all">{String(value)}</dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          )}

          {externalUrl && (
            <a
              href={externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              Open in {sourceLabels[card.source_type] || "source"}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function TodoStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return <CheckCircle className="h-3.5 w-3.5 text-green-600 shrink-0" />;
    case "in_progress":
      return <CircleDot className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
    default:
      return <Circle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
  }
}

function LogEntry({ log }: { log: ProcessingLog }) {
  switch (log.step) {
    case "start":
    case "evaluating":
    case "executing":
      return (
        <div className="flex items-start gap-2 text-amber-600 dark:text-amber-400">
          <Loader2 className="h-3 w-3 mt-0.5 animate-spin shrink-0" />
          <span>{log.message}</span>
        </div>
      );
    case "ai_output":
      return (
        <div className="pl-5 font-mono text-muted-foreground whitespace-pre-wrap break-all">
          {log.message}
        </div>
      );
    case "question":
      return (
        <div className="flex items-start gap-2 text-amber-600 dark:text-amber-400">
          <MessageCircleQuestion className="h-3 w-3 mt-0.5 shrink-0" />
          <span className="font-medium">Q: {log.message}</span>
        </div>
      );
    case "answer":
      return (
        <div className="flex items-start gap-2 text-blue-600 dark:text-blue-400">
          <Send className="h-3 w-3 mt-0.5 shrink-0" />
          <span>A: {log.message}</span>
        </div>
      );
    case "todo":
      return null; // Rendered separately in the TODO section
    case "done":
    case "executed":
      return (
        <div className="flex items-start gap-2 text-green-600 dark:text-green-400">
          <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0" />
          <span>{log.message}</span>
        </div>
      );
    case "low_confidence":
    case "error":
      return (
        <div className="flex items-start gap-2 text-red-600 dark:text-red-400">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          <span>{log.message}</span>
        </div>
      );
    default:
      return (
        <div className="flex items-start gap-2 text-muted-foreground">
          <span className="pl-5">{log.message}</span>
        </div>
      );
  }
}

interface ChecklistItem {
  text: string;
  checked: boolean;
}

function parsePlanChecklist(body: string | null): ChecklistItem[] {
  if (!body) return [];
  const items: ChecklistItem[] = [];
  const regex = /^[-*]\s+\[([ xX])\]\s+(.+)$/gm;
  let match;
  while ((match = regex.exec(body)) !== null) {
    items.push({
      checked: match[1] !== " ",
      text: match[2].trim(),
    });
  }
  return items;
}
```

**Step 3: Commit**

```bash
git add client/src/components/CardDetailPanel.tsx client/src/components/Board.tsx
git commit -m "feat: add execution logs viewer, TODO section, and Q&A interface to detail panel"
```

---

### Task 10: Integration Smoke Test

**Step 1: Run all server tests**

Run: `cd server && npx vitest run`
Expected: All tests pass

**Step 2: Run TypeScript compilation check**

Run: `cd server && npx tsc --noEmit && cd ../client && npx tsc --noEmit && cd ../shared && npx tsc --noEmit`
Expected: No type errors

**Step 3: Start dev server and verify UI loads**

Run: `cd /Users/shakedamar/Projects/daily-kanban && npm run dev --workspace=server` (in one terminal)
Run: `cd /Users/shakedamar/Projects/daily-kanban && npm run dev --workspace=client` (in another)

Verify:
- Board loads
- Clicking a card opens detail panel
- New sections (Tasks, Execution Logs) appear for cards that have been processed
- No console errors

**Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: integration fixes for execution UI"
```
