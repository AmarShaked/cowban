# Daily Kanban — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a local-first daily kanban web app that aggregates tasks from Gmail, Calendar, Linear, GitLab, and Telegram, with Claude CLI-powered automation evaluation and execution.

**Architecture:** Monolith — single Node.js Express backend + React Vite SPA. SQLite for storage. npm workspaces monorepo with `client`, `server`, and `shared` packages. Claude CLI spawned as child process for AI evaluation.

**Tech Stack:** React + Vite + TypeScript + shadcn/ui + Tailwind CSS, Express + TypeScript, SQLite via better-sqlite3, Drizzle ORM, @hello-pangea/dnd for drag-and-drop.

---

## Phase 1: Project Scaffolding

### Task 1: Initialize Monorepo

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`

**Step 1: Create root package.json with workspaces**

```json
{
  "name": "daily-kanban",
  "private": true,
  "workspaces": ["shared", "server", "client"],
  "scripts": {
    "dev": "concurrently \"npm run dev -w server\" \"npm run dev -w client\"",
    "build": "npm run build -w shared && npm run build -w server && npm run build -w client"
  }
}
```

Write to: `package.json`

**Step 2: Create base TypeScript config**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src"
  }
}
```

Write to: `tsconfig.base.json`

**Step 3: Create .gitignore**

```
node_modules/
dist/
*.db
*.db-journal
.env
.env.local
```

Write to: `.gitignore`

**Step 4: Install root dev dependencies**

Run: `npm install -D concurrently typescript`

**Step 5: Commit**

```bash
git add package.json tsconfig.base.json .gitignore package-lock.json
git commit -m "chore: initialize monorepo with npm workspaces"
```

---

### Task 2: Scaffold Shared Package

**Files:**
- Create: `shared/package.json`
- Create: `shared/tsconfig.json`
- Create: `shared/src/types.ts`

**Step 1: Create shared package.json**

```json
{
  "name": "@daily-kanban/shared",
  "version": "0.0.1",
  "private": true,
  "main": "./src/types.ts",
  "types": "./src/types.ts",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  }
}
```

**Step 2: Create shared tsconfig.json**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

**Step 3: Create shared types**

```typescript
// shared/src/types.ts

export type ColumnName = "inbox" | "review" | "ai_do" | "human_do" | "done";

export type SourceType = "gmail" | "calendar" | "linear" | "gitlab" | "telegram" | "manual";

export interface Board {
  id: number;
  date: string; // YYYY-MM-DD
  created_at: string;
}

export interface Card {
  id: number;
  board_id: number;
  source_id: string | null;
  source_type: SourceType;
  column_name: ColumnName;
  title: string;
  body: string | null;
  metadata: Record<string, unknown> | null;
  ai_toggle: boolean;
  confidence: number | null;
  proposed_action: string | null;
  action_payload: Record<string, unknown> | null;
  execution_result: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConnectorConfig {
  id: number;
  type: SourceType;
  credentials: Record<string, unknown> | null;
  settings: Record<string, unknown> | null;
  enabled: boolean;
}

export interface KanbanItem {
  source_id: string;
  source_type: SourceType;
  title: string;
  body: string | null;
  metadata: Record<string, unknown>;
}

export interface ActionPayload {
  type: string;
  [key: string]: unknown;
}

export interface ActionResult {
  success: boolean;
  message: string;
}

export interface AiEvaluation {
  canAutomate: boolean;
  confidence: number;
  proposedAction: string;
  actionPayload: ActionPayload | null;
}

// API request/response types
export interface CreateCardRequest {
  title: string;
  body?: string;
}

export interface MoveCardRequest {
  column_name: ColumnName;
}

export interface ToggleAiRequest {
  ai_toggle: boolean;
}
```

**Step 4: Commit**

```bash
git add shared/
git commit -m "chore: scaffold shared types package"
```

---

### Task 3: Scaffold Server Package

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/src/index.ts`

**Step 1: Create server package.json**

```json
{
  "name": "@daily-kanban/server",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@daily-kanban/shared": "*",
    "better-sqlite3": "^11.0.0",
    "cors": "^2.8.5",
    "express": "^4.21.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/cors": "^2.8.0",
    "@types/express": "^4.17.0",
    "tsx": "^4.0.0",
    "vitest": "^2.0.0"
  }
}
```

**Step 2: Create server tsconfig.json**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "ESNext",
    "moduleResolution": "bundler"
  },
  "include": ["src"],
  "references": [{ "path": "../shared" }]
}
```

**Step 3: Create minimal Express server**

```typescript
// server/src/index.ts
import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

export default app;
```

**Step 4: Install server dependencies**

Run: `cd /Users/shakedamar/Projects/daily-kanban && npm install`

**Step 5: Verify server starts**

Run: `cd /Users/shakedamar/Projects/daily-kanban && npx tsx server/src/index.ts &` then `curl http://localhost:3001/api/health` — expect `{"status":"ok"}`

Kill the server after verification.

**Step 6: Commit**

```bash
git add server/ package-lock.json
git commit -m "chore: scaffold Express server package"
```

---

### Task 4: Scaffold Client Package

**Files:**
- Create: `client/` via Vite scaffolding
- Modify: `client/package.json` (add workspace name)
- Install: shadcn/ui + Tailwind

**Step 1: Scaffold React + Vite + TypeScript**

Run: `cd /Users/shakedamar/Projects/daily-kanban && npm create vite@latest client -- --template react-ts`

**Step 2: Update client package.json name**

Change the `name` field to `"@daily-kanban/client"` and add `"@daily-kanban/shared": "*"` to dependencies.

**Step 3: Install Tailwind CSS v4**

Run: `cd /Users/shakedamar/Projects/daily-kanban/client && npm install tailwindcss @tailwindcss/vite`

Add the Tailwind Vite plugin to `client/vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
```

Replace `client/src/index.css` with:

```css
@import "tailwindcss";
```

**Step 4: Install and initialize shadcn/ui**

Run: `cd /Users/shakedamar/Projects/daily-kanban/client && npx shadcn@latest init`

Choose: TypeScript, Default style, Neutral base color, CSS variables.

**Step 5: Install shadcn components needed for MVP**

Run: `cd /Users/shakedamar/Projects/daily-kanban/client && npx shadcn@latest add button card badge switch toast dialog input textarea`

**Step 6: Verify client starts**

Run: `cd /Users/shakedamar/Projects/daily-kanban/client && npm run dev` — expect Vite dev server on http://localhost:5173

**Step 7: Install from root and commit**

Run: `cd /Users/shakedamar/Projects/daily-kanban && npm install`

```bash
git add client/ package-lock.json
git commit -m "chore: scaffold React + Vite client with shadcn/ui and Tailwind"
```

---

## Phase 2: Database

### Task 5: Set Up SQLite Database

**Files:**
- Create: `server/src/db/database.ts`
- Create: `server/src/db/migrate.ts`
- Create: `server/src/db/migrations/001_initial.sql`
- Test: `server/src/db/__tests__/database.test.ts`

**Step 1: Write the failing test**

```typescript
// server/src/db/__tests__/database.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../migrate.js";

describe("database", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("creates all tables after migration", () => {
    migrate(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain("boards");
    expect(tableNames).toContain("cards");
    expect(tableNames).toContain("connector_configs");
    expect(tableNames).toContain("settings");
  });

  it("enforces unique board per date", () => {
    migrate(db);

    db.prepare("INSERT INTO boards (date) VALUES ('2026-02-15')").run();
    expect(() => {
      db.prepare("INSERT INTO boards (date) VALUES ('2026-02-15')").run();
    }).toThrow();
  });

  it("enforces unique source_id per board", () => {
    migrate(db);

    db.prepare("INSERT INTO boards (date) VALUES ('2026-02-15')").run();
    const board = db.prepare("SELECT id FROM boards WHERE date = '2026-02-15'").get() as { id: number };

    db.prepare(
      "INSERT INTO cards (board_id, source_id, source_type, title) VALUES (?, 'gmail:123', 'gmail', 'Test')"
    ).run(board.id);

    expect(() => {
      db.prepare(
        "INSERT INTO cards (board_id, source_id, source_type, title) VALUES (?, 'gmail:123', 'gmail', 'Duplicate')"
      ).run(board.id);
    }).toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/shakedamar/Projects/daily-kanban && npx vitest run server/src/db/__tests__/database.test.ts`
Expected: FAIL — cannot find module `../migrate.js`

**Step 3: Create migration SQL**

```sql
-- server/src/db/migrations/001_initial.sql
CREATE TABLE IF NOT EXISTS boards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date DATE UNIQUE NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id INTEGER NOT NULL REFERENCES boards(id),
  source_id TEXT,
  source_type TEXT NOT NULL,
  column_name TEXT NOT NULL DEFAULT 'inbox',
  title TEXT NOT NULL,
  body TEXT,
  metadata JSON,
  ai_toggle INTEGER DEFAULT 0,
  confidence REAL,
  proposed_action TEXT,
  action_payload JSON,
  execution_result TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(board_id, source_id)
);

CREATE TABLE IF NOT EXISTS connector_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL UNIQUE,
  credentials JSON,
  settings JSON,
  enabled INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSON
);
```

**Step 4: Create migrate function**

```typescript
// server/src/db/migrate.ts
import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function migrate(db: Database.Database): void {
  const sql = readFileSync(join(__dirname, "migrations", "001_initial.sql"), "utf-8");
  db.exec(sql);
}
```

**Step 5: Create database singleton**

```typescript
// server/src/db/database.ts
import Database from "better-sqlite3";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { migrate } from "./migrate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, "..", "..", "daily-kanban.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    migrate(db);
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
```

**Step 6: Run test to verify it passes**

Run: `cd /Users/shakedamar/Projects/daily-kanban && npx vitest run server/src/db/__tests__/database.test.ts`
Expected: 3 tests PASS

**Step 7: Commit**

```bash
git add server/src/db/
git commit -m "feat: add SQLite database with migration"
```

---

## Phase 3: Backend API — Board & Cards

### Task 6: Board Repository

**Files:**
- Create: `server/src/db/board-repo.ts`
- Test: `server/src/db/__tests__/board-repo.test.ts`

**Step 1: Write the failing test**

```typescript
// server/src/db/__tests__/board-repo.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../migrate.js";
import { BoardRepo } from "../board-repo.js";

describe("BoardRepo", () => {
  let db: Database.Database;
  let repo: BoardRepo;

  beforeEach(() => {
    db = new Database(":memory:");
    migrate(db);
    repo = new BoardRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  it("getOrCreateToday creates a board for today", () => {
    const board = repo.getOrCreateToday();
    expect(board.date).toBe(new Date().toISOString().split("T")[0]);
  });

  it("getOrCreateToday returns existing board if already created", () => {
    const board1 = repo.getOrCreateToday();
    const board2 = repo.getOrCreateToday();
    expect(board1.id).toBe(board2.id);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/shakedamar/Projects/daily-kanban && npx vitest run server/src/db/__tests__/board-repo.test.ts`

**Step 3: Implement BoardRepo**

```typescript
// server/src/db/board-repo.ts
import Database from "better-sqlite3";
import type { Board } from "@daily-kanban/shared";

export class BoardRepo {
  constructor(private db: Database.Database) {}

  getOrCreateToday(): Board {
    const today = new Date().toISOString().split("T")[0];

    const existing = this.db
      .prepare("SELECT * FROM boards WHERE date = ?")
      .get(today) as Board | undefined;

    if (existing) return existing;

    const result = this.db
      .prepare("INSERT INTO boards (date) VALUES (?)")
      .run(today);

    return this.db
      .prepare("SELECT * FROM boards WHERE id = ?")
      .get(result.lastInsertRowid) as Board;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/shakedamar/Projects/daily-kanban && npx vitest run server/src/db/__tests__/board-repo.test.ts`
Expected: 2 tests PASS

**Step 5: Commit**

```bash
git add server/src/db/board-repo.ts server/src/db/__tests__/board-repo.test.ts
git commit -m "feat: add BoardRepo with getOrCreateToday"
```

---

### Task 7: Card Repository

**Files:**
- Create: `server/src/db/card-repo.ts`
- Test: `server/src/db/__tests__/card-repo.test.ts`

**Step 1: Write the failing test**

```typescript
// server/src/db/__tests__/card-repo.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../migrate.js";
import { CardRepo } from "../card-repo.js";
import type { ColumnName } from "@daily-kanban/shared";

describe("CardRepo", () => {
  let db: Database.Database;
  let repo: CardRepo;
  let boardId: number;

  beforeEach(() => {
    db = new Database(":memory:");
    migrate(db);
    repo = new CardRepo(db);
    const result = db.prepare("INSERT INTO boards (date) VALUES ('2026-02-15')").run();
    boardId = Number(result.lastInsertRowid);
  });

  afterEach(() => {
    db.close();
  });

  it("creates a card and retrieves it", () => {
    const card = repo.create({
      board_id: boardId,
      source_id: "gmail:123",
      source_type: "gmail",
      title: "Test email",
      body: "Hello world",
      metadata: { from: "test@example.com" },
    });
    expect(card.id).toBeDefined();
    expect(card.title).toBe("Test email");
    expect(card.column_name).toBe("inbox");
  });

  it("lists cards for a board", () => {
    repo.create({ board_id: boardId, source_id: "a", source_type: "gmail", title: "Card A", body: null, metadata: null });
    repo.create({ board_id: boardId, source_id: "b", source_type: "linear", title: "Card B", body: null, metadata: null });
    const cards = repo.listByBoard(boardId);
    expect(cards).toHaveLength(2);
  });

  it("moves a card to a different column", () => {
    const card = repo.create({ board_id: boardId, source_id: "a", source_type: "gmail", title: "Card A", body: null, metadata: null });
    repo.moveToColumn(card.id, "human_do");
    const updated = repo.getById(card.id);
    expect(updated?.column_name).toBe("human_do");
  });

  it("updates AI evaluation fields", () => {
    const card = repo.create({ board_id: boardId, source_id: "a", source_type: "gmail", title: "Card A", body: null, metadata: null });
    repo.setAiEvaluation(card.id, {
      confidence: 85,
      proposed_action: "Reply with acceptance",
      action_payload: { type: "reply", body: "Sure!" },
    });
    const updated = repo.getById(card.id);
    expect(updated?.confidence).toBe(85);
    expect(updated?.proposed_action).toBe("Reply with acceptance");
  });

  it("skips duplicate source_id on same board", () => {
    repo.create({ board_id: boardId, source_id: "gmail:123", source_type: "gmail", title: "First", body: null, metadata: null });
    const duplicate = repo.upsertFromConnector({
      board_id: boardId,
      source_id: "gmail:123",
      source_type: "gmail",
      title: "Duplicate",
      body: null,
      metadata: null,
    });
    expect(duplicate).toBeNull();
    const cards = repo.listByBoard(boardId);
    expect(cards).toHaveLength(1);
    expect(cards[0].title).toBe("First");
  });

  it("toggles AI field", () => {
    const card = repo.create({ board_id: boardId, source_id: "a", source_type: "gmail", title: "Card A", body: null, metadata: null });
    expect(card.ai_toggle).toBe(false);
    repo.setAiToggle(card.id, true);
    const updated = repo.getById(card.id);
    expect(updated?.ai_toggle).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/shakedamar/Projects/daily-kanban && npx vitest run server/src/db/__tests__/card-repo.test.ts`

**Step 3: Implement CardRepo**

```typescript
// server/src/db/card-repo.ts
import Database from "better-sqlite3";
import type { Card, ColumnName } from "@daily-kanban/shared";

interface CreateCardInput {
  board_id: number;
  source_id: string | null;
  source_type: string;
  title: string;
  body: string | null;
  metadata: Record<string, unknown> | null;
}

interface AiEvaluationInput {
  confidence: number;
  proposed_action: string;
  action_payload: Record<string, unknown> | null;
}

function rowToCard(row: Record<string, unknown>): Card {
  return {
    ...row,
    ai_toggle: Boolean(row.ai_toggle),
    metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
    action_payload: row.action_payload ? JSON.parse(row.action_payload as string) : null,
  } as Card;
}

export class CardRepo {
  constructor(private db: Database.Database) {}

  create(input: CreateCardInput): Card {
    const result = this.db
      .prepare(
        `INSERT INTO cards (board_id, source_id, source_type, title, body, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.board_id,
        input.source_id,
        input.source_type,
        input.title,
        input.body,
        input.metadata ? JSON.stringify(input.metadata) : null
      );

    return this.getById(Number(result.lastInsertRowid))!;
  }

  upsertFromConnector(input: CreateCardInput): Card | null {
    const existing = this.db
      .prepare("SELECT id FROM cards WHERE board_id = ? AND source_id = ?")
      .get(input.board_id, input.source_id);

    if (existing) return null;
    return this.create(input);
  }

  getById(id: number): Card | null {
    const row = this.db.prepare("SELECT * FROM cards WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? rowToCard(row) : null;
  }

  listByBoard(boardId: number): Card[] {
    const rows = this.db
      .prepare("SELECT * FROM cards WHERE board_id = ? ORDER BY created_at ASC")
      .all(boardId) as Record<string, unknown>[];
    return rows.map(rowToCard);
  }

  moveToColumn(id: number, column: ColumnName): void {
    this.db
      .prepare("UPDATE cards SET column_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(column, id);
  }

  setAiToggle(id: number, value: boolean): void {
    this.db
      .prepare("UPDATE cards SET ai_toggle = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(value ? 1 : 0, id);
  }

  setAiEvaluation(id: number, input: AiEvaluationInput): void {
    this.db
      .prepare(
        `UPDATE cards SET confidence = ?, proposed_action = ?, action_payload = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      )
      .run(
        input.confidence,
        input.proposed_action,
        input.action_payload ? JSON.stringify(input.action_payload) : null,
        id
      );
  }

  setExecutionResult(id: number, result: string): void {
    this.db
      .prepare("UPDATE cards SET execution_result = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(result, id);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/shakedamar/Projects/daily-kanban && npx vitest run server/src/db/__tests__/card-repo.test.ts`
Expected: 6 tests PASS

**Step 5: Commit**

```bash
git add server/src/db/card-repo.ts server/src/db/__tests__/card-repo.test.ts
git commit -m "feat: add CardRepo with CRUD, move, AI toggle, dedup"
```

---

### Task 8: Board API Routes

**Files:**
- Create: `server/src/routes/board.ts`
- Create: `server/src/routes/cards.ts`
- Test: `server/src/routes/__tests__/board.test.ts`

**Step 1: Write the failing test**

```typescript
// server/src/routes/__tests__/board.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import Database from "better-sqlite3";
import { migrate } from "../../db/migrate.js";
import { createBoardRouter } from "../board.js";
import { createCardsRouter } from "../cards.js";
import { BoardRepo } from "../../db/board-repo.js";
import { CardRepo } from "../../db/card-repo.js";

describe("Board & Cards API", () => {
  let app: express.Express;
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    migrate(db);
    const boardRepo = new BoardRepo(db);
    const cardRepo = new CardRepo(db);

    app = express();
    app.use(express.json());
    app.use("/api/board", createBoardRouter(boardRepo, cardRepo));
    app.use("/api/cards", createCardsRouter(cardRepo));
  });

  afterEach(() => {
    db.close();
  });

  it("GET /api/board/today returns today's board with cards", async () => {
    const res = await request(app).get("/api/board/today");
    expect(res.status).toBe(200);
    expect(res.body.board.date).toBe(new Date().toISOString().split("T")[0]);
    expect(res.body.cards).toEqual([]);
  });

  it("POST /api/cards creates a manual card", async () => {
    // First create today's board
    await request(app).get("/api/board/today");

    const res = await request(app)
      .post("/api/cards")
      .send({ title: "My manual task", body: "Do this thing" });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe("My manual task");
    expect(res.body.source_type).toBe("manual");
    expect(res.body.column_name).toBe("inbox");
  });

  it("PATCH /api/cards/:id/move moves a card", async () => {
    await request(app).get("/api/board/today");
    const card = await request(app)
      .post("/api/cards")
      .send({ title: "Task" });

    const res = await request(app)
      .patch(`/api/cards/${card.body.id}/move`)
      .send({ column_name: "human_do" });
    expect(res.status).toBe(200);
    expect(res.body.column_name).toBe("human_do");
  });

  it("PATCH /api/cards/:id/ai-toggle toggles AI", async () => {
    await request(app).get("/api/board/today");
    const card = await request(app)
      .post("/api/cards")
      .send({ title: "Task" });

    const res = await request(app)
      .patch(`/api/cards/${card.body.id}/ai-toggle`)
      .send({ ai_toggle: true });
    expect(res.status).toBe(200);
    expect(res.body.ai_toggle).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/shakedamar/Projects/daily-kanban && npm install -D supertest @types/supertest -w server && npx vitest run server/src/routes/__tests__/board.test.ts`

**Step 3: Implement board router**

```typescript
// server/src/routes/board.ts
import { Router } from "express";
import type { BoardRepo } from "../db/board-repo.js";
import type { CardRepo } from "../db/card-repo.js";

export function createBoardRouter(boardRepo: BoardRepo, cardRepo: CardRepo): Router {
  const router = Router();

  router.get("/today", (_req, res) => {
    const board = boardRepo.getOrCreateToday();
    const cards = cardRepo.listByBoard(board.id);
    res.json({ board, cards });
  });

  return router;
}
```

**Step 4: Implement cards router**

```typescript
// server/src/routes/cards.ts
import { Router } from "express";
import type { CardRepo } from "../db/card-repo.js";
import type { ColumnName, CreateCardRequest, MoveCardRequest, ToggleAiRequest } from "@daily-kanban/shared";
import { getDb } from "../db/database.js";
import { BoardRepo } from "../db/board-repo.js";

export function createCardsRouter(cardRepo: CardRepo): Router {
  const router = Router();

  router.post("/", (req, res) => {
    const { title, body } = req.body as CreateCardRequest;
    // Get today's board — the board must exist (created via GET /board/today)
    const db = cardRepo["db"]; // Access db to get board
    const boardRepo = new BoardRepo(db);
    const board = boardRepo.getOrCreateToday();

    const card = cardRepo.create({
      board_id: board.id,
      source_id: null,
      source_type: "manual",
      title,
      body: body || null,
      metadata: null,
    });
    res.status(201).json(card);
  });

  router.patch("/:id/move", (req, res) => {
    const id = Number(req.params.id);
    const { column_name } = req.body as MoveCardRequest;
    cardRepo.moveToColumn(id, column_name);
    const card = cardRepo.getById(id);
    res.json(card);
  });

  router.patch("/:id/ai-toggle", (req, res) => {
    const id = Number(req.params.id);
    const { ai_toggle } = req.body as ToggleAiRequest;
    cardRepo.setAiToggle(id, ai_toggle);
    const card = cardRepo.getById(id);
    res.json(card);
  });

  return router;
}
```

**Step 5: Run test to verify it passes**

Run: `cd /Users/shakedamar/Projects/daily-kanban && npx vitest run server/src/routes/__tests__/board.test.ts`
Expected: 4 tests PASS

**Step 6: Wire routes into server/src/index.ts**

Update `server/src/index.ts` to import and mount routes:

```typescript
// server/src/index.ts
import express from "express";
import cors from "cors";
import { getDb } from "./db/database.js";
import { BoardRepo } from "./db/board-repo.js";
import { CardRepo } from "./db/card-repo.js";
import { createBoardRouter } from "./routes/board.js";
import { createCardsRouter } from "./routes/cards.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const db = getDb();
const boardRepo = new BoardRepo(db);
const cardRepo = new CardRepo(db);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/board", createBoardRouter(boardRepo, cardRepo));
app.use("/api/cards", createCardsRouter(cardRepo));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

export default app;
```

**Step 7: Commit**

```bash
git add server/src/routes/ server/src/index.ts server/package.json package-lock.json
git commit -m "feat: add Board and Cards API routes"
```

---

## Phase 4: Frontend — Kanban Board UI

### Task 9: API Client

**Files:**
- Create: `client/src/lib/api.ts`

**Step 1: Create the API client**

```typescript
// client/src/lib/api.ts
import type { Board, Card, ColumnName } from "@daily-kanban/shared";

const BASE = "/api";

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export const api = {
  getBoard: () => fetchJson<{ board: Board; cards: Card[] }>("/board/today"),

  createCard: (title: string, body?: string) =>
    fetchJson<Card>("/cards", {
      method: "POST",
      body: JSON.stringify({ title, body }),
    }),

  moveCard: (id: number, column_name: ColumnName) =>
    fetchJson<Card>(`/cards/${id}/move`, {
      method: "PATCH",
      body: JSON.stringify({ column_name }),
    }),

  toggleAi: (id: number, ai_toggle: boolean) =>
    fetchJson<Card>(`/cards/${id}/ai-toggle`, {
      method: "PATCH",
      body: JSON.stringify({ ai_toggle }),
    }),
};
```

**Step 2: Commit**

```bash
git add client/src/lib/api.ts
git commit -m "feat: add API client for board and cards"
```

---

### Task 10: useBoard Hook

**Files:**
- Create: `client/src/hooks/useBoard.ts`

**Step 1: Create the hook**

```typescript
// client/src/hooks/useBoard.ts
import { useState, useEffect, useCallback } from "react";
import type { Board, Card, ColumnName } from "@daily-kanban/shared";
import { api } from "../lib/api";

export function useBoard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api.getBoard();
      setBoard(data.board);
      setCards(data.cards);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load board");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const moveCard = useCallback(async (cardId: number, column: ColumnName) => {
    const updated = await api.moveCard(cardId, column);
    setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }, []);

  const toggleAi = useCallback(async (cardId: number, value: boolean) => {
    const updated = await api.toggleAi(cardId, value);
    setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }, []);

  const createCard = useCallback(async (title: string, body?: string) => {
    const card = await api.createCard(title, body);
    setCards((prev) => [...prev, card]);
  }, []);

  const cardsByColumn = (column: ColumnName) =>
    cards.filter((c) => c.column_name === column);

  return {
    board,
    cards,
    loading,
    error,
    refresh,
    moveCard,
    toggleAi,
    createCard,
    cardsByColumn,
  };
}
```

**Step 2: Commit**

```bash
git add client/src/hooks/useBoard.ts
git commit -m "feat: add useBoard hook"
```

---

### Task 11: KanbanCard Component

**Files:**
- Create: `client/src/components/KanbanCard.tsx`

**Step 1: Create the card component**

```tsx
// client/src/components/KanbanCard.tsx
import type { Card, ColumnName } from "@daily-kanban/shared";
import { Card as ShadcnCard, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Draggable } from "@hello-pangea/dnd";
import { Mail, Calendar, GitMerge, Send, ListTodo, PenLine } from "lucide-react";

const sourceIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  gmail: Mail,
  calendar: Calendar,
  linear: ListTodo,
  gitlab: GitMerge,
  telegram: Send,
  manual: PenLine,
};

interface KanbanCardProps {
  card: Card;
  index: number;
  onToggleAi: (cardId: number, value: boolean) => void;
}

export function KanbanCard({ card, index, onToggleAi }: KanbanCardProps) {
  const Icon = sourceIcons[card.source_type] || PenLine;

  return (
    <Draggable draggableId={String(card.id)} index={index}>
      {(provided) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className="mb-2"
        >
          <ShadcnCard className="shadow-sm">
            <CardHeader className="p-3 pb-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-sm font-medium leading-tight">
                    {card.title}
                  </CardTitle>
                </div>
                {card.confidence !== null && (
                  <Badge variant={card.confidence >= 80 ? "default" : "secondary"}>
                    {card.confidence}%
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-3 pt-1">
              {card.body && (
                <CardDescription className="text-xs line-clamp-2 mb-2">
                  {card.body}
                </CardDescription>
              )}
              {card.proposed_action && (
                <p className="text-xs text-blue-600 dark:text-blue-400 mb-2">
                  AI: {card.proposed_action}
                </p>
              )}
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {new Date(card.created_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                {card.column_name === "inbox" && (
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">AI</span>
                    <Switch
                      checked={card.ai_toggle}
                      onCheckedChange={(checked) => onToggleAi(card.id, checked)}
                      className="scale-75"
                    />
                  </div>
                )}
              </div>
            </CardContent>
          </ShadcnCard>
        </div>
      )}
    </Draggable>
  );
}
```

**Step 2: Commit**

```bash
git add client/src/components/KanbanCard.tsx
git commit -m "feat: add KanbanCard component with drag support"
```

---

### Task 12: KanbanColumn Component

**Files:**
- Create: `client/src/components/KanbanColumn.tsx`

**Step 1: Create the column component**

```tsx
// client/src/components/KanbanColumn.tsx
import type { Card, ColumnName } from "@daily-kanban/shared";
import { Droppable } from "@hello-pangea/dnd";
import { KanbanCard } from "./KanbanCard";

const columnLabels: Record<ColumnName, string> = {
  inbox: "Inbox",
  review: "Review",
  ai_do: "AI Do",
  human_do: "Human Do",
  done: "Done",
};

const columnColors: Record<ColumnName, string> = {
  inbox: "border-t-blue-500",
  review: "border-t-yellow-500",
  ai_do: "border-t-purple-500",
  human_do: "border-t-orange-500",
  done: "border-t-green-500",
};

interface KanbanColumnProps {
  column: ColumnName;
  cards: Card[];
  onToggleAi: (cardId: number, value: boolean) => void;
}

export function KanbanColumn({ column, cards, onToggleAi }: KanbanColumnProps) {
  return (
    <div
      className={`flex flex-col w-72 min-w-[18rem] bg-muted/50 rounded-lg border-t-4 ${columnColors[column]}`}
    >
      <div className="flex items-center justify-between p-3 pb-2">
        <h2 className="text-sm font-semibold">{columnLabels[column]}</h2>
        <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
          {cards.length}
        </span>
      </div>
      <Droppable droppableId={column}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`flex-1 p-2 min-h-[200px] transition-colors ${
              snapshot.isDraggingOver ? "bg-muted" : ""
            }`}
          >
            {cards.map((card, index) => (
              <KanbanCard
                key={card.id}
                card={card}
                index={index}
                onToggleAi={onToggleAi}
              />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add client/src/components/KanbanColumn.tsx
git commit -m "feat: add KanbanColumn component with droppable zones"
```

---

### Task 13: Board Component and App Integration

**Files:**
- Create: `client/src/components/Board.tsx`
- Create: `client/src/components/CreateCardDialog.tsx`
- Modify: `client/src/App.tsx`

**Step 1: Install drag-and-drop library and icons**

Run: `cd /Users/shakedamar/Projects/daily-kanban/client && npm install @hello-pangea/dnd lucide-react`

**Step 2: Create CreateCardDialog**

```tsx
// client/src/components/CreateCardDialog.tsx
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus } from "lucide-react";

interface CreateCardDialogProps {
  onCreateCard: (title: string, body?: string) => Promise<void>;
}

export function CreateCardDialog({ onCreateCard }: CreateCardDialogProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const handleSubmit = async () => {
    if (!title.trim()) return;
    await onCreateCard(title.trim(), body.trim() || undefined);
    setTitle("");
    setBody("");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="h-4 w-4 mr-1" /> New Task
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Task</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="Task title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          />
          <Textarea
            placeholder="Description (optional)"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
          />
          <Button onClick={handleSubmit} disabled={!title.trim()} className="w-full">
            Create
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 3: Create Board component**

```tsx
// client/src/components/Board.tsx
import type { ColumnName } from "@daily-kanban/shared";
import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import { KanbanColumn } from "./KanbanColumn";
import { CreateCardDialog } from "./CreateCardDialog";
import { useBoard } from "../hooks/useBoard";

const COLUMNS: ColumnName[] = ["inbox", "review", "ai_do", "human_do", "done"];

export function Board() {
  const { board, loading, error, moveCard, toggleAi, createCard, cardsByColumn, refresh } =
    useBoard();

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const cardId = Number(result.draggableId);
    const newColumn = result.destination.droppableId as ColumnName;
    moveCard(cardId, newColumn);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-muted-foreground">
        Loading board...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen text-destructive">
        {error}
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="flex items-center justify-between p-4 border-b">
        <div>
          <h1 className="text-lg font-bold">Daily Kanban</h1>
          <p className="text-xs text-muted-foreground">{board?.date}</p>
        </div>
        <div className="flex gap-2">
          <CreateCardDialog onCreateCard={createCard} />
        </div>
      </header>
      <div className="flex-1 overflow-x-auto p-4">
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex gap-4 h-full">
            {COLUMNS.map((col) => (
              <KanbanColumn
                key={col}
                column={col}
                cards={cardsByColumn(col)}
                onToggleAi={toggleAi}
              />
            ))}
          </div>
        </DragDropContext>
      </div>
    </div>
  );
}
```

**Step 4: Update App.tsx**

```tsx
// client/src/App.tsx
import { Board } from "./components/Board";

export default function App() {
  return <Board />;
}
```

**Step 5: Verify it works**

Run dev servers (`npm run dev` at root) and open http://localhost:5173. Should see 5 empty columns with "New Task" button. Create a card, drag it between columns.

**Step 6: Commit**

```bash
git add client/src/components/ client/src/App.tsx client/package.json package-lock.json
git commit -m "feat: add kanban board UI with drag-and-drop and card creation"
```

---

## Phase 5: Connector Infrastructure

### Task 14: Connector Interface and Registry

**Files:**
- Create: `server/src/connectors/types.ts`
- Create: `server/src/connectors/registry.ts`
- Test: `server/src/connectors/__tests__/registry.test.ts`

**Step 1: Write the failing test**

```typescript
// server/src/connectors/__tests__/registry.test.ts
import { describe, it, expect } from "vitest";
import { ConnectorRegistry } from "../registry.js";
import type { Connector } from "../types.js";

const mockConnector: Connector = {
  name: "mock",
  icon: "mock-icon",
  async fetchItems() {
    return [
      {
        source_id: "mock:1",
        source_type: "gmail",
        title: "Mock item",
        body: "Body",
        metadata: {},
      },
    ];
  },
  async executeAction() {
    return { success: true, message: "done" };
  },
};

describe("ConnectorRegistry", () => {
  it("registers and retrieves connectors", () => {
    const registry = new ConnectorRegistry();
    registry.register("mock", mockConnector);
    expect(registry.get("mock")).toBe(mockConnector);
    expect(registry.getAll()).toHaveLength(1);
  });

  it("returns undefined for unknown connector", () => {
    const registry = new ConnectorRegistry();
    expect(registry.get("unknown")).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/shakedamar/Projects/daily-kanban && npx vitest run server/src/connectors/__tests__/registry.test.ts`

**Step 3: Create connector types**

```typescript
// server/src/connectors/types.ts
import type { KanbanItem, ActionPayload, ActionResult, SourceType } from "@daily-kanban/shared";

export interface Connector {
  name: string;
  icon: string;
  fetchItems(): Promise<KanbanItem[]>;
  executeAction(item: KanbanItem, action: ActionPayload): Promise<ActionResult>;
}
```

**Step 4: Create connector registry**

```typescript
// server/src/connectors/registry.ts
import type { Connector } from "./types.js";

export class ConnectorRegistry {
  private connectors = new Map<string, Connector>();

  register(name: string, connector: Connector): void {
    this.connectors.set(name, connector);
  }

  get(name: string): Connector | undefined {
    return this.connectors.get(name);
  }

  getAll(): Connector[] {
    return Array.from(this.connectors.values());
  }

  getAllEntries(): [string, Connector][] {
    return Array.from(this.connectors.entries());
  }
}
```

**Step 5: Run test to verify it passes**

Run: `cd /Users/shakedamar/Projects/daily-kanban && npx vitest run server/src/connectors/__tests__/registry.test.ts`
Expected: 2 tests PASS

**Step 6: Commit**

```bash
git add server/src/connectors/
git commit -m "feat: add connector interface and registry"
```

---

### Task 15: Polling Scheduler

**Files:**
- Create: `server/src/scheduler.ts`
- Test: `server/src/scheduler.test.ts`

**Step 1: Write the failing test**

```typescript
// server/src/__tests__/scheduler.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../db/migrate.js";
import { Scheduler } from "../scheduler.js";
import { ConnectorRegistry } from "../connectors/registry.js";
import { BoardRepo } from "../db/board-repo.js";
import { CardRepo } from "../db/card-repo.js";
import type { Connector } from "../connectors/types.js";

describe("Scheduler", () => {
  let db: Database.Database;
  let registry: ConnectorRegistry;
  let boardRepo: BoardRepo;
  let cardRepo: CardRepo;

  beforeEach(() => {
    db = new Database(":memory:");
    migrate(db);
    registry = new ConnectorRegistry();
    boardRepo = new BoardRepo(db);
    cardRepo = new CardRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  it("polls connectors and inserts new items", async () => {
    const mockConnector: Connector = {
      name: "mock",
      icon: "mock",
      async fetchItems() {
        return [
          { source_id: "mock:1", source_type: "gmail", title: "Item 1", body: null, metadata: {} },
          { source_id: "mock:2", source_type: "gmail", title: "Item 2", body: null, metadata: {} },
        ];
      },
      async executeAction() {
        return { success: true, message: "ok" };
      },
    };

    registry.register("mock", mockConnector);

    const scheduler = new Scheduler(registry, boardRepo, cardRepo);
    await scheduler.pollAll();

    const board = boardRepo.getOrCreateToday();
    const cards = cardRepo.listByBoard(board.id);
    expect(cards).toHaveLength(2);
    expect(cards[0].title).toBe("Item 1");
  });

  it("skips duplicate items on second poll", async () => {
    const mockConnector: Connector = {
      name: "mock",
      icon: "mock",
      async fetchItems() {
        return [
          { source_id: "mock:1", source_type: "gmail", title: "Item 1", body: null, metadata: {} },
        ];
      },
      async executeAction() {
        return { success: true, message: "ok" };
      },
    };

    registry.register("mock", mockConnector);

    const scheduler = new Scheduler(registry, boardRepo, cardRepo);
    await scheduler.pollAll();
    await scheduler.pollAll();

    const board = boardRepo.getOrCreateToday();
    const cards = cardRepo.listByBoard(board.id);
    expect(cards).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/shakedamar/Projects/daily-kanban && npx vitest run server/src/__tests__/scheduler.test.ts`

**Step 3: Implement Scheduler**

```typescript
// server/src/scheduler.ts
import type { ConnectorRegistry } from "./connectors/registry.js";
import type { BoardRepo } from "./db/board-repo.js";
import type { CardRepo } from "./db/card-repo.js";

export class Scheduler {
  private intervals: NodeJS.Timeout[] = [];

  constructor(
    private registry: ConnectorRegistry,
    private boardRepo: BoardRepo,
    private cardRepo: CardRepo
  ) {}

  async pollAll(): Promise<void> {
    const board = this.boardRepo.getOrCreateToday();
    const connectors = this.registry.getAllEntries();

    for (const [name, connector] of connectors) {
      try {
        const items = await connector.fetchItems();
        for (const item of items) {
          this.cardRepo.upsertFromConnector({
            board_id: board.id,
            source_id: item.source_id,
            source_type: item.source_type,
            title: item.title,
            body: item.body,
            metadata: item.metadata,
          });
        }
      } catch (err) {
        console.error(`Connector ${name} poll failed:`, err);
      }
    }
  }

  start(intervalMs: number = 5 * 60 * 1000): void {
    // Poll immediately on start
    this.pollAll();

    const interval = setInterval(() => {
      this.pollAll();
    }, intervalMs);

    this.intervals.push(interval);
  }

  stop(): void {
    for (const interval of this.intervals) {
      clearInterval(interval);
    }
    this.intervals = [];
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/shakedamar/Projects/daily-kanban && npx vitest run server/src/__tests__/scheduler.test.ts`
Expected: 2 tests PASS

**Step 5: Commit**

```bash
git add server/src/scheduler.ts server/src/__tests__/scheduler.test.ts
git commit -m "feat: add polling scheduler with dedup"
```

---

## Phase 6: AI Evaluation Engine

### Task 16: Claude CLI Evaluator

**Files:**
- Create: `server/src/ai/claude-evaluator.ts`
- Test: `server/src/ai/__tests__/claude-evaluator.test.ts`

**Step 1: Write the failing test**

```typescript
// server/src/ai/__tests__/claude-evaluator.test.ts
import { describe, it, expect, vi } from "vitest";
import { ClaudeEvaluator, parseClaudeResponse } from "../claude-evaluator.js";

describe("parseClaudeResponse", () => {
  it("parses a valid JSON response", () => {
    const raw = JSON.stringify({
      canAutomate: true,
      confidence: 90,
      proposedAction: "Reply to email",
      actionPayload: { type: "reply", body: "Got it!" },
    });
    const result = parseClaudeResponse(raw);
    expect(result.canAutomate).toBe(true);
    expect(result.confidence).toBe(90);
    expect(result.proposedAction).toBe("Reply to email");
  });

  it("parses JSON embedded in markdown code block", () => {
    const raw = `Here's my analysis:\n\`\`\`json\n{"canAutomate":true,"confidence":85,"proposedAction":"Archive email","actionPayload":{"type":"archive"}}\n\`\`\``;
    const result = parseClaudeResponse(raw);
    expect(result.canAutomate).toBe(true);
    expect(result.confidence).toBe(85);
  });

  it("returns cannot-automate for unparseable response", () => {
    const result = parseClaudeResponse("I don't know what to do with this");
    expect(result.canAutomate).toBe(false);
    expect(result.confidence).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/shakedamar/Projects/daily-kanban && npx vitest run server/src/ai/__tests__/claude-evaluator.test.ts`

**Step 3: Implement ClaudeEvaluator**

```typescript
// server/src/ai/claude-evaluator.ts
import { execFile } from "child_process";
import { promisify } from "util";
import type { Card, AiEvaluation } from "@daily-kanban/shared";

const execFileAsync = promisify(execFile);

export function parseClaudeResponse(raw: string): AiEvaluation {
  try {
    // Try direct JSON parse
    const parsed = JSON.parse(raw);
    return validateEvaluation(parsed);
  } catch {
    // Try extracting JSON from markdown code block
    const jsonMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1].trim());
        return validateEvaluation(parsed);
      } catch {
        // fall through
      }
    }
  }

  return {
    canAutomate: false,
    confidence: 0,
    proposedAction: "Could not evaluate this item",
    actionPayload: null,
  };
}

function validateEvaluation(obj: Record<string, unknown>): AiEvaluation {
  return {
    canAutomate: Boolean(obj.canAutomate),
    confidence: typeof obj.confidence === "number" ? obj.confidence : 0,
    proposedAction: typeof obj.proposedAction === "string" ? obj.proposedAction : "",
    actionPayload: obj.actionPayload as AiEvaluation["actionPayload"] ?? null,
  };
}

export class ClaudeEvaluator {
  private timeoutMs: number;

  constructor(timeoutMs: number = 30000) {
    this.timeoutMs = timeoutMs;
  }

  async evaluate(card: Card, availableActions: string[]): Promise<AiEvaluation> {
    const prompt = this.buildPrompt(card, availableActions);

    try {
      const { stdout } = await execFileAsync(
        "claude",
        ["-p", prompt, "--output-format", "json"],
        { timeout: this.timeoutMs }
      );

      // Claude CLI with --output-format json returns { result: "..." }
      let responseText = stdout.trim();
      try {
        const wrapper = JSON.parse(responseText);
        if (wrapper.result) responseText = wrapper.result;
      } catch {
        // stdout is already the raw text
      }

      return parseClaudeResponse(responseText);
    } catch (err) {
      console.error("Claude CLI evaluation failed:", err);
      return {
        canAutomate: false,
        confidence: 0,
        proposedAction: "AI evaluation failed",
        actionPayload: null,
      };
    }
  }

  private buildPrompt(card: Card, availableActions: string[]): string {
    return `You are evaluating a task item to determine if it can be automated.

Source: ${card.source_type}
Title: ${card.title}
Body: ${card.body || "(empty)"}
Metadata: ${JSON.stringify(card.metadata || {})}

Available actions for this source type: ${availableActions.join(", ")}

Respond with ONLY a JSON object (no extra text):
{
  "canAutomate": boolean,
  "confidence": number (0-100),
  "proposedAction": "human-readable description of what you would do",
  "actionPayload": { "type": "action_type", ...params } or null
}

If you can confidently handle this with one of the available actions, set canAutomate to true and provide the action details. If not, set canAutomate to false.`;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/shakedamar/Projects/daily-kanban && npx vitest run server/src/ai/__tests__/claude-evaluator.test.ts`
Expected: 3 tests PASS

**Step 5: Commit**

```bash
git add server/src/ai/
git commit -m "feat: add Claude CLI evaluator with response parsing"
```

---

### Task 17: Wire AI Toggle to Evaluator

**Files:**
- Create: `server/src/routes/ai.ts`
- Modify: `server/src/index.ts`

**Step 1: Create AI route**

```typescript
// server/src/routes/ai.ts
import { Router } from "express";
import type { CardRepo } from "../db/card-repo.js";
import { ClaudeEvaluator } from "../ai/claude-evaluator.js";
import type { ConnectorRegistry } from "../connectors/registry.js";

const AVAILABLE_ACTIONS: Record<string, string[]> = {
  gmail: ["reply", "archive", "label"],
  calendar: ["summarize"],
  linear: ["update_status", "add_comment", "close"],
  gitlab: ["post_review_comment", "approve"],
  telegram: [],
  manual: [],
};

export function createAiRouter(
  cardRepo: CardRepo,
  evaluator: ClaudeEvaluator,
  confidenceThreshold: number = 80
): Router {
  const router = Router();

  router.post("/evaluate/:cardId", async (req, res) => {
    const cardId = Number(req.params.cardId);
    const card = cardRepo.getById(cardId);

    if (!card) {
      res.status(404).json({ error: "Card not found" });
      return;
    }

    const actions = AVAILABLE_ACTIONS[card.source_type] || [];
    const evaluation = await evaluator.evaluate(card, actions);

    if (evaluation.canAutomate && evaluation.confidence >= confidenceThreshold) {
      cardRepo.setAiEvaluation(cardId, {
        confidence: evaluation.confidence,
        proposed_action: evaluation.proposedAction,
        action_payload: evaluation.actionPayload,
      });
      cardRepo.moveToColumn(cardId, "review");
    } else {
      // Reset toggle, keep in inbox
      cardRepo.setAiToggle(cardId, false);
      cardRepo.setAiEvaluation(cardId, {
        confidence: evaluation.confidence,
        proposed_action: evaluation.proposedAction,
        action_payload: null,
      });
    }

    const updated = cardRepo.getById(cardId);
    res.json(updated);
  });

  return router;
}
```

**Step 2: Update server/src/index.ts to mount AI routes**

Add to imports and mount:

```typescript
import { ClaudeEvaluator } from "./ai/claude-evaluator.js";
import { createAiRouter } from "./routes/ai.js";

const evaluator = new ClaudeEvaluator();
app.use("/api/ai", createAiRouter(cardRepo, evaluator));
```

**Step 3: Update client API and hook to trigger evaluation**

Add to `client/src/lib/api.ts`:

```typescript
evaluateCard: (cardId: number) =>
  fetchJson<Card>(`/ai/evaluate/${cardId}`, { method: "POST" }),
```

Update `client/src/hooks/useBoard.ts` toggleAi to also trigger evaluation:

```typescript
const toggleAi = useCallback(async (cardId: number, value: boolean) => {
  const updated = await api.toggleAi(cardId, value);
  setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));

  if (value) {
    // Trigger AI evaluation
    try {
      const evaluated = await api.evaluateCard(cardId);
      setCards((prev) => prev.map((c) => (c.id === evaluated.id ? evaluated : c)));
    } catch {
      // Evaluation failed — card stays in inbox with toggle reset
      const refreshed = await api.toggleAi(cardId, false);
      setCards((prev) => prev.map((c) => (c.id === refreshed.id ? refreshed : c)));
    }
  }
}, []);
```

**Step 4: Commit**

```bash
git add server/src/routes/ai.ts server/src/index.ts client/src/lib/api.ts client/src/hooks/useBoard.ts
git commit -m "feat: wire AI toggle to Claude evaluator"
```

---

## Phase 7: Connectors

### Task 18: Gmail Connector

**Files:**
- Create: `server/src/connectors/gmail.ts`
- Test: `server/src/connectors/__tests__/gmail.test.ts`

**Step 1: Install googleapis**

Run: `cd /Users/shakedamar/Projects/daily-kanban && npm install googleapis -w server`

**Step 2: Write the failing test**

```typescript
// server/src/connectors/__tests__/gmail.test.ts
import { describe, it, expect, vi } from "vitest";
import { GmailConnector } from "../gmail.js";

describe("GmailConnector", () => {
  it("transforms gmail messages to KanbanItems", () => {
    const connector = new GmailConnector();
    const items = connector.transformMessages([
      {
        id: "msg_123",
        payload: {
          headers: [
            { name: "Subject", value: "Meeting tomorrow" },
            { name: "From", value: "alice@example.com" },
          ],
        },
        snippet: "Let's meet at 10am",
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0].source_id).toBe("gmail:msg_123");
    expect(items[0].source_type).toBe("gmail");
    expect(items[0].title).toBe("Meeting tomorrow");
    expect(items[0].metadata).toEqual({
      from: "alice@example.com",
      messageId: "msg_123",
    });
  });
});
```

**Step 3: Run test to verify it fails**

Run: `cd /Users/shakedamar/Projects/daily-kanban && npx vitest run server/src/connectors/__tests__/gmail.test.ts`

**Step 4: Implement GmailConnector**

```typescript
// server/src/connectors/gmail.ts
import { google } from "googleapis";
import type { Connector } from "./types.js";
import type { KanbanItem, ActionPayload, ActionResult } from "@daily-kanban/shared";

interface GmailMessage {
  id: string;
  payload?: {
    headers?: { name: string; value: string }[];
  };
  snippet?: string;
}

export class GmailConnector implements Connector {
  name = "Gmail";
  icon = "mail";
  private auth: any = null;

  setAuth(auth: any) {
    this.auth = auth;
  }

  transformMessages(messages: GmailMessage[]): KanbanItem[] {
    return messages.map((msg) => {
      const headers = msg.payload?.headers || [];
      const subject = headers.find((h) => h.name === "Subject")?.value || "(no subject)";
      const from = headers.find((h) => h.name === "From")?.value || "unknown";

      return {
        source_id: `gmail:${msg.id}`,
        source_type: "gmail",
        title: subject,
        body: msg.snippet || null,
        metadata: { from, messageId: msg.id },
      };
    });
  }

  async fetchItems(): Promise<KanbanItem[]> {
    if (!this.auth) return [];

    const gmail = google.gmail({ version: "v1", auth: this.auth });
    const today = new Date().toISOString().split("T")[0].replace(/-/g, "/");

    const res = await gmail.users.messages.list({
      userId: "me",
      q: `is:unread after:${today}`,
      maxResults: 50,
    });

    if (!res.data.messages) return [];

    const messages: GmailMessage[] = [];
    for (const msg of res.data.messages) {
      const full = await gmail.users.messages.get({
        userId: "me",
        id: msg.id!,
        format: "metadata",
        metadataHeaders: ["Subject", "From"],
      });
      messages.push(full.data as GmailMessage);
    }

    return this.transformMessages(messages);
  }

  async executeAction(item: KanbanItem, action: ActionPayload): Promise<ActionResult> {
    if (!this.auth) return { success: false, message: "Gmail not authenticated" };

    const gmail = google.gmail({ version: "v1", auth: this.auth });
    const messageId = item.metadata?.messageId as string;

    switch (action.type) {
      case "reply": {
        const raw = Buffer.from(
          `To: ${item.metadata?.from}\r\nSubject: Re: ${item.title}\r\nIn-Reply-To: ${messageId}\r\n\r\n${action.body}`
        ).toString("base64url");

        await gmail.users.messages.send({ userId: "me", requestBody: { raw, threadId: messageId } });
        return { success: true, message: `Replied to ${item.metadata?.from}` };
      }
      case "archive": {
        await gmail.users.messages.modify({
          userId: "me",
          id: messageId,
          requestBody: { removeLabelIds: ["INBOX"] },
        });
        return { success: true, message: "Email archived" };
      }
      default:
        return { success: false, message: `Unknown action: ${action.type}` };
    }
  }
}
```

**Step 5: Run test to verify it passes**

Run: `cd /Users/shakedamar/Projects/daily-kanban && npx vitest run server/src/connectors/__tests__/gmail.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add server/src/connectors/gmail.ts server/src/connectors/__tests__/gmail.test.ts server/package.json package-lock.json
git commit -m "feat: add Gmail connector"
```

---

### Task 19: Google Calendar Connector

**Files:**
- Create: `server/src/connectors/calendar.ts`
- Test: `server/src/connectors/__tests__/calendar.test.ts`

**Step 1: Write the failing test**

```typescript
// server/src/connectors/__tests__/calendar.test.ts
import { describe, it, expect } from "vitest";
import { CalendarConnector } from "../calendar.js";

describe("CalendarConnector", () => {
  it("transforms calendar events to KanbanItems", () => {
    const connector = new CalendarConnector();
    const items = connector.transformEvents([
      {
        id: "evt_1",
        summary: "Team standup",
        start: { dateTime: "2026-02-15T10:00:00Z" },
        end: { dateTime: "2026-02-15T10:30:00Z" },
        description: "Daily sync",
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0].source_id).toBe("calendar:evt_1");
    expect(items[0].title).toBe("Team standup");
    expect(items[0].metadata).toMatchObject({
      eventId: "evt_1",
      start: "2026-02-15T10:00:00Z",
      end: "2026-02-15T10:30:00Z",
    });
  });
});
```

**Step 2: Implement CalendarConnector**

```typescript
// server/src/connectors/calendar.ts
import { google } from "googleapis";
import type { Connector } from "./types.js";
import type { KanbanItem, ActionPayload, ActionResult } from "@daily-kanban/shared";

interface CalendarEvent {
  id: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  description?: string;
}

export class CalendarConnector implements Connector {
  name = "Calendar";
  icon = "calendar";
  private auth: any = null;

  setAuth(auth: any) {
    this.auth = auth;
  }

  transformEvents(events: CalendarEvent[]): KanbanItem[] {
    return events.map((evt) => ({
      source_id: `calendar:${evt.id}`,
      source_type: "calendar" as const,
      title: evt.summary || "(no title)",
      body: evt.description || null,
      metadata: {
        eventId: evt.id,
        start: evt.start?.dateTime || evt.start?.date || "",
        end: evt.end?.dateTime || evt.end?.date || "",
      },
    }));
  }

  async fetchItems(): Promise<KanbanItem[]> {
    if (!this.auth) return [];

    const calendar = google.calendar({ version: "v3", auth: this.auth });
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    const res = await calendar.events.list({
      calendarId: "primary",
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });

    return this.transformEvents((res.data.items || []) as CalendarEvent[]);
  }

  async executeAction(_item: KanbanItem, _action: ActionPayload): Promise<ActionResult> {
    return { success: false, message: "Calendar connector is read-only" };
  }
}
```

**Step 3: Run test, verify pass, commit**

```bash
git add server/src/connectors/calendar.ts server/src/connectors/__tests__/calendar.test.ts
git commit -m "feat: add Google Calendar connector"
```

---

### Task 20: Linear Connector

**Files:**
- Create: `server/src/connectors/linear.ts`
- Test: `server/src/connectors/__tests__/linear.test.ts`

**Step 1: Install Linear SDK**

Run: `cd /Users/shakedamar/Projects/daily-kanban && npm install @linear/sdk -w server`

**Step 2: Write the failing test**

```typescript
// server/src/connectors/__tests__/linear.test.ts
import { describe, it, expect } from "vitest";
import { LinearConnector } from "../linear.js";

describe("LinearConnector", () => {
  it("transforms linear issues to KanbanItems", () => {
    const connector = new LinearConnector();
    const items = connector.transformIssues([
      {
        id: "issue_1",
        identifier: "ENG-123",
        title: "Fix login bug",
        description: "Users can't log in",
        url: "https://linear.app/team/issue/ENG-123",
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0].source_id).toBe("linear:issue_1");
    expect(items[0].title).toBe("[ENG-123] Fix login bug");
  });
});
```

**Step 3: Implement LinearConnector**

```typescript
// server/src/connectors/linear.ts
import { LinearClient } from "@linear/sdk";
import type { Connector } from "./types.js";
import type { KanbanItem, ActionPayload, ActionResult } from "@daily-kanban/shared";

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  url: string;
}

export class LinearConnector implements Connector {
  name = "Linear";
  icon = "list-todo";
  private client: LinearClient | null = null;

  setApiKey(apiKey: string) {
    this.client = new LinearClient({ apiKey });
  }

  transformIssues(issues: LinearIssue[]): KanbanItem[] {
    return issues.map((issue) => ({
      source_id: `linear:${issue.id}`,
      source_type: "linear" as const,
      title: `[${issue.identifier}] ${issue.title}`,
      body: issue.description || null,
      metadata: { issueId: issue.id, identifier: issue.identifier, url: issue.url },
    }));
  }

  async fetchItems(): Promise<KanbanItem[]> {
    if (!this.client) return [];

    const me = await this.client.viewer;
    const issues = await me.assignedIssues({
      filter: { state: { name: { eq: "Todo" } } },
    });

    const rawIssues: LinearIssue[] = issues.nodes.map((i) => ({
      id: i.id,
      identifier: i.identifier,
      title: i.title,
      description: i.description ?? undefined,
      url: i.url,
    }));

    return this.transformIssues(rawIssues);
  }

  async executeAction(item: KanbanItem, action: ActionPayload): Promise<ActionResult> {
    if (!this.client) return { success: false, message: "Linear not authenticated" };

    const issueId = item.metadata?.issueId as string;

    switch (action.type) {
      case "add_comment": {
        await this.client.createComment({
          issueId,
          body: action.body as string,
        });
        return { success: true, message: "Comment added" };
      }
      case "update_status": {
        const issue = await this.client.issue(issueId);
        const team = await issue.team;
        if (!team) return { success: false, message: "No team found" };
        const states = await team.states();
        const targetState = states.nodes.find((s) => s.name === action.status);
        if (!targetState) return { success: false, message: `Status "${action.status}" not found` };
        await this.client.updateIssue(issueId, { stateId: targetState.id });
        return { success: true, message: `Status updated to ${action.status}` };
      }
      default:
        return { success: false, message: `Unknown action: ${action.type}` };
    }
  }
}
```

**Step 4: Run test, verify pass, commit**

```bash
git add server/src/connectors/linear.ts server/src/connectors/__tests__/linear.test.ts server/package.json package-lock.json
git commit -m "feat: add Linear connector"
```

---

### Task 21: GitLab Connector

**Files:**
- Create: `server/src/connectors/gitlab.ts`
- Test: `server/src/connectors/__tests__/gitlab.test.ts`

**Step 1: Write the failing test**

```typescript
// server/src/connectors/__tests__/gitlab.test.ts
import { describe, it, expect } from "vitest";
import { GitLabConnector } from "../gitlab.js";

describe("GitLabConnector", () => {
  it("transforms MRs to KanbanItems", () => {
    const connector = new GitLabConnector();
    const items = connector.transformMergeRequests([
      {
        id: 42,
        iid: 7,
        title: "Add dark mode",
        description: "Implements dark mode toggle",
        web_url: "https://gitlab.com/team/repo/-/merge_requests/7",
        source_branch: "feature/dark-mode",
        author: { name: "Alice" },
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0].source_id).toBe("gitlab:42");
    expect(items[0].title).toBe("MR !7: Add dark mode");
  });
});
```

**Step 2: Implement GitLabConnector**

```typescript
// server/src/connectors/gitlab.ts
import type { Connector } from "./types.js";
import type { KanbanItem, ActionPayload, ActionResult } from "@daily-kanban/shared";

interface GitLabMR {
  id: number;
  iid: number;
  title: string;
  description?: string;
  web_url: string;
  source_branch: string;
  author: { name: string };
}

export class GitLabConnector implements Connector {
  name = "GitLab";
  icon = "git-merge";
  private baseUrl: string = "";
  private token: string = "";

  configure(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
  }

  transformMergeRequests(mrs: GitLabMR[]): KanbanItem[] {
    return mrs.map((mr) => ({
      source_id: `gitlab:${mr.id}`,
      source_type: "gitlab" as const,
      title: `MR !${mr.iid}: ${mr.title}`,
      body: mr.description || null,
      metadata: {
        mrId: mr.id,
        mrIid: mr.iid,
        webUrl: mr.web_url,
        sourceBranch: mr.source_branch,
        author: mr.author.name,
      },
    }));
  }

  private async gitlabFetch(path: string, options?: RequestInit) {
    const res = await fetch(`${this.baseUrl}/api/v4${path}`, {
      headers: { "PRIVATE-TOKEN": this.token },
      ...options,
    });
    if (!res.ok) throw new Error(`GitLab API error: ${res.status}`);
    return res.json();
  }

  async fetchItems(): Promise<KanbanItem[]> {
    if (!this.token) return [];

    const mrs = (await this.gitlabFetch(
      "/merge_requests?state=opened&scope=assigned_to_me&reviewer_username=me"
    )) as GitLabMR[];

    return this.transformMergeRequests(mrs);
  }

  async executeAction(item: KanbanItem, action: ActionPayload): Promise<ActionResult> {
    if (!this.token) return { success: false, message: "GitLab not authenticated" };

    const projectPath = (item.metadata?.webUrl as string)?.match(/(.+)\/-\//)?.[1];
    const mrIid = item.metadata?.mrIid;

    switch (action.type) {
      case "post_review_comment": {
        const projectId = encodeURIComponent((item.metadata?.webUrl as string).split("/-/")[0].split(".com/")[1]);
        await this.gitlabFetch(`/projects/${projectId}/merge_requests/${mrIid}/notes`, {
          method: "POST",
          headers: { "PRIVATE-TOKEN": this.token, "Content-Type": "application/json" },
          body: JSON.stringify({ body: action.body }),
        });
        return { success: true, message: "Review comment posted" };
      }
      case "approve": {
        const projectId = encodeURIComponent((item.metadata?.webUrl as string).split("/-/")[0].split(".com/")[1]);
        await this.gitlabFetch(`/projects/${projectId}/merge_requests/${mrIid}/approve`, {
          method: "POST",
        });
        return { success: true, message: "MR approved" };
      }
      default:
        return { success: false, message: `Unknown action: ${action.type}` };
    }
  }
}
```

**Step 3: Run test, verify pass, commit**

```bash
git add server/src/connectors/gitlab.ts server/src/connectors/__tests__/gitlab.test.ts
git commit -m "feat: add GitLab connector"
```

---

### Task 22: Telegram Bot Connector

**Files:**
- Create: `server/src/connectors/telegram.ts`
- Test: `server/src/connectors/__tests__/telegram.test.ts`

**Step 1: Install telegram bot API**

Run: `cd /Users/shakedamar/Projects/daily-kanban && npm install node-telegram-bot-api -w server && npm install -D @types/node-telegram-bot-api -w server`

**Step 2: Write the failing test**

```typescript
// server/src/connectors/__tests__/telegram.test.ts
import { describe, it, expect } from "vitest";
import { TelegramConnector } from "../telegram.js";

describe("TelegramConnector", () => {
  it("transforms a text message into a KanbanItem", () => {
    const connector = new TelegramConnector();
    const item = connector.transformMessage({
      message_id: 42,
      date: 1739577600,
      chat: { id: 123, type: "private" },
      text: "Remember to deploy the API changes",
    });

    expect(item.source_id).toBe("telegram:42");
    expect(item.source_type).toBe("telegram");
    expect(item.title).toBe("Remember to deploy the API changes");
  });

  it("truncates long messages for title and puts full text in body", () => {
    const connector = new TelegramConnector();
    const longText = "A".repeat(200);
    const item = connector.transformMessage({
      message_id: 43,
      date: 1739577600,
      chat: { id: 123, type: "private" },
      text: longText,
    });

    expect(item.title.length).toBeLessThanOrEqual(103); // 100 + "..."
    expect(item.body).toBe(longText);
  });
});
```

**Step 3: Implement TelegramConnector**

```typescript
// server/src/connectors/telegram.ts
import TelegramBot from "node-telegram-bot-api";
import type { Connector } from "./types.js";
import type { KanbanItem, ActionPayload, ActionResult } from "@daily-kanban/shared";
import type { CardRepo } from "../db/card-repo.js";
import type { BoardRepo } from "../db/board-repo.js";
import { ClaudeEvaluator } from "../ai/claude-evaluator.js";

interface TelegramMessage {
  message_id: number;
  date: number;
  chat: { id: number; type: string };
  text?: string;
  voice?: { file_id: string; duration: number };
}

export class TelegramConnector implements Connector {
  name = "Telegram";
  icon = "send";
  private bot: TelegramBot | null = null;
  private boardRepo: BoardRepo | null = null;
  private cardRepo: CardRepo | null = null;

  configure(token: string, boardRepo: BoardRepo, cardRepo: CardRepo) {
    this.boardRepo = boardRepo;
    this.cardRepo = cardRepo;
    this.bot = new TelegramBot(token, { polling: true });

    this.bot.on("message", async (msg) => {
      await this.handleMessage(msg as unknown as TelegramMessage);
    });
  }

  transformMessage(msg: TelegramMessage): KanbanItem {
    const text = msg.text || "(voice message)";
    const title = text.length > 100 ? text.slice(0, 100) + "..." : text;

    return {
      source_id: `telegram:${msg.message_id}`,
      source_type: "telegram",
      title,
      body: text.length > 100 ? text : null,
      metadata: { messageId: msg.message_id, chatId: msg.chat.id },
    };
  }

  private async handleMessage(msg: TelegramMessage): Promise<void> {
    if (!this.boardRepo || !this.cardRepo) return;

    // For voice messages, we'd transcribe here (future enhancement)
    const item = this.transformMessage(msg);
    const board = this.boardRepo.getOrCreateToday();

    this.cardRepo.upsertFromConnector({
      board_id: board.id,
      source_id: item.source_id,
      source_type: item.source_type,
      title: item.title,
      body: item.body,
      metadata: item.metadata,
    });
  }

  // Telegram is input-only — fetchItems returns empty (bot pushes items via handleMessage)
  async fetchItems(): Promise<KanbanItem[]> {
    return [];
  }

  async executeAction(_item: KanbanItem, _action: ActionPayload): Promise<ActionResult> {
    return { success: false, message: "Telegram connector is input-only" };
  }

  stop() {
    this.bot?.stopPolling();
  }
}
```

**Step 4: Run test, verify pass, commit**

```bash
git add server/src/connectors/telegram.ts server/src/connectors/__tests__/telegram.test.ts server/package.json package-lock.json
git commit -m "feat: add Telegram bot connector"
```

---

## Phase 8: Execution Engine

### Task 23: AI Execution Route (AI Do Column)

**Files:**
- Modify: `server/src/routes/ai.ts`

**Step 1: Add execution endpoint to AI router**

Add to `server/src/routes/ai.ts`:

```typescript
router.post("/execute/:cardId", async (req, res) => {
  const cardId = Number(req.params.cardId);
  const card = cardRepo.getById(cardId);

  if (!card) {
    res.status(404).json({ error: "Card not found" });
    return;
  }

  if (!card.action_payload) {
    res.status(400).json({ error: "No action payload" });
    return;
  }

  const connector = registry.get(card.source_type);
  if (!connector) {
    res.status(400).json({ error: `No connector for ${card.source_type}` });
    return;
  }

  const item: KanbanItem = {
    source_id: card.source_id!,
    source_type: card.source_type,
    title: card.title,
    body: card.body,
    metadata: card.metadata || {},
  };

  const result = await connector.executeAction(item, card.action_payload as ActionPayload);

  if (result.success) {
    cardRepo.setExecutionResult(cardId, result.message);
    cardRepo.moveToColumn(cardId, "done");
  } else {
    cardRepo.setExecutionResult(cardId, `Failed: ${result.message}`);
    cardRepo.moveToColumn(cardId, "review");
  }

  const updated = cardRepo.getById(cardId);
  res.json(updated);
});
```

Update the `createAiRouter` function signature to accept `registry: ConnectorRegistry` and import `KanbanItem` and `ActionPayload` types.

**Step 2: Update client to trigger execution when card moves to ai_do**

In `client/src/hooks/useBoard.ts`, update `moveCard`:

```typescript
const moveCard = useCallback(async (cardId: number, column: ColumnName) => {
  const updated = await api.moveCard(cardId, column);
  setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));

  // If moved to ai_do, trigger execution
  if (column === "ai_do") {
    try {
      const executed = await api.executeCard(cardId);
      setCards((prev) => prev.map((c) => (c.id === executed.id ? executed : c)));
    } catch {
      // Execution failed — will be reflected in card state after refresh
      await refresh();
    }
  }
}, [refresh]);
```

Add to `client/src/lib/api.ts`:

```typescript
executeCard: (cardId: number) =>
  fetchJson<Card>(`/ai/execute/${cardId}`, { method: "POST" }),
```

**Step 3: Commit**

```bash
git add server/src/routes/ai.ts client/src/hooks/useBoard.ts client/src/lib/api.ts
git commit -m "feat: add AI execution engine for AI Do column"
```

---

## Phase 9: Settings & Connector Configuration

### Task 24: Settings Routes

**Files:**
- Create: `server/src/db/settings-repo.ts`
- Create: `server/src/routes/settings.ts`
- Create: `server/src/routes/connectors.ts`

**Step 1: Create SettingsRepo**

```typescript
// server/src/db/settings-repo.ts
import Database from "better-sqlite3";

export class SettingsRepo {
  constructor(private db: Database.Database) {}

  get<T>(key: string, defaultValue: T): T {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : defaultValue;
  }

  set(key: string, value: unknown): void {
    this.db
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
      .run(key, JSON.stringify(value));
  }
}
```

**Step 2: Create settings router**

```typescript
// server/src/routes/settings.ts
import { Router } from "express";
import type { SettingsRepo } from "../db/settings-repo.js";

export function createSettingsRouter(settingsRepo: SettingsRepo): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({
      confidence_threshold: settingsRepo.get("confidence_threshold", 80),
      poll_interval_ms: settingsRepo.get("poll_interval_ms", 5 * 60 * 1000),
    });
  });

  router.patch("/", (req, res) => {
    const { confidence_threshold, poll_interval_ms } = req.body;
    if (confidence_threshold !== undefined) settingsRepo.set("confidence_threshold", confidence_threshold);
    if (poll_interval_ms !== undefined) settingsRepo.set("poll_interval_ms", poll_interval_ms);
    res.json({ success: true });
  });

  return router;
}
```

**Step 3: Create connectors config router**

```typescript
// server/src/routes/connectors.ts
import { Router } from "express";
import Database from "better-sqlite3";
import type { ConnectorConfig } from "@daily-kanban/shared";

export function createConnectorsRouter(db: Database.Database): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const configs = db.prepare("SELECT * FROM connector_configs ORDER BY type").all() as ConnectorConfig[];
    res.json(configs.map((c) => ({ ...c, credentials: c.credentials ? "configured" : null, enabled: Boolean(c.enabled) })));
  });

  router.put("/:type", (req, res) => {
    const { type } = req.params;
    const { credentials, settings, enabled } = req.body;

    db.prepare(
      `INSERT OR REPLACE INTO connector_configs (type, credentials, settings, enabled)
       VALUES (?, ?, ?, ?)`
    ).run(
      type,
      credentials ? JSON.stringify(credentials) : null,
      settings ? JSON.stringify(settings) : null,
      enabled ? 1 : 0
    );

    res.json({ success: true });
  });

  return router;
}
```

**Step 4: Mount in server/src/index.ts**

```typescript
import { SettingsRepo } from "./db/settings-repo.js";
import { createSettingsRouter } from "./routes/settings.js";
import { createConnectorsRouter } from "./routes/connectors.js";

const settingsRepo = new SettingsRepo(db);
app.use("/api/settings", createSettingsRouter(settingsRepo));
app.use("/api/connectors", createConnectorsRouter(db));
```

**Step 5: Commit**

```bash
git add server/src/db/settings-repo.ts server/src/routes/settings.ts server/src/routes/connectors.ts server/src/index.ts
git commit -m "feat: add settings and connector config routes"
```

---

### Task 25: Settings UI Page

**Files:**
- Create: `client/src/components/Settings.tsx`
- Modify: `client/src/App.tsx` (add routing)

**Step 1: Install React Router**

Run: `cd /Users/shakedamar/Projects/daily-kanban/client && npm install react-router-dom`

**Step 2: Create Settings component**

```tsx
// client/src/components/Settings.tsx
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

interface ConnectorConfigUI {
  type: string;
  credentials: string | null;
  enabled: boolean;
}

export function Settings() {
  const [threshold, setThreshold] = useState(80);
  const [pollInterval, setPollInterval] = useState(5);
  const [connectors, setConnectors] = useState<ConnectorConfigUI[]>([]);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setThreshold(data.confidence_threshold);
        setPollInterval(data.poll_interval_ms / 60000);
      });
    fetch("/api/connectors")
      .then((r) => r.json())
      .then(setConnectors);
  }, []);

  const saveSettings = async () => {
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confidence_threshold: threshold,
        poll_interval_ms: pollInterval * 60000,
      }),
    });
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-lg font-bold">Settings</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium">Confidence Threshold (%)</label>
            <Input
              type="number"
              min={0}
              max={100}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="text-sm font-medium">Poll Interval (minutes)</label>
            <Input
              type="number"
              min={1}
              max={60}
              value={pollInterval}
              onChange={(e) => setPollInterval(Number(e.target.value))}
            />
          </div>
          <Button onClick={saveSettings}>Save</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connectors</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {["gmail", "calendar", "linear", "gitlab", "telegram"].map((type) => {
            const config = connectors.find((c) => c.type === type);
            return (
              <div key={type} className="flex items-center justify-between py-2 border-b last:border-0">
                <div>
                  <p className="text-sm font-medium capitalize">{type}</p>
                  <p className="text-xs text-muted-foreground">
                    {config?.credentials ? "Configured" : "Not configured"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Button variant="outline" size="sm">
                    Configure
                  </Button>
                  <Switch checked={config?.enabled ?? false} />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
```

**Step 3: Update App.tsx with routing**

```tsx
// client/src/App.tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Board } from "./components/Board";
import { Settings } from "./components/Settings";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Board />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </BrowserRouter>
  );
}
```

**Step 4: Add Settings link in Board header**

In `client/src/components/Board.tsx`, add a settings link in the header next to CreateCardDialog:

```tsx
import { Link } from "react-router-dom";
import { Settings as SettingsIcon } from "lucide-react";

// In the header div, alongside CreateCardDialog:
<Link to="/settings">
  <Button variant="ghost" size="icon">
    <SettingsIcon className="h-4 w-4" />
  </Button>
</Link>
```

**Step 5: Commit**

```bash
git add client/src/components/Settings.tsx client/src/App.tsx client/src/components/Board.tsx client/package.json package-lock.json
git commit -m "feat: add Settings page with connector configuration UI"
```

---

## Phase 10: Integration & Server Wiring

### Task 26: Wire All Connectors Into Server

**Files:**
- Modify: `server/src/index.ts`

**Step 1: Wire connectors, scheduler, and AI into the main server**

```typescript
// server/src/index.ts — full updated version
import express from "express";
import cors from "cors";
import { getDb } from "./db/database.js";
import { BoardRepo } from "./db/board-repo.js";
import { CardRepo } from "./db/card-repo.js";
import { SettingsRepo } from "./db/settings-repo.js";
import { createBoardRouter } from "./routes/board.js";
import { createCardsRouter } from "./routes/cards.js";
import { createAiRouter } from "./routes/ai.js";
import { createSettingsRouter } from "./routes/settings.js";
import { createConnectorsRouter } from "./routes/connectors.js";
import { ConnectorRegistry } from "./connectors/registry.js";
import { GmailConnector } from "./connectors/gmail.js";
import { CalendarConnector } from "./connectors/calendar.js";
import { LinearConnector } from "./connectors/linear.js";
import { GitLabConnector } from "./connectors/gitlab.js";
import { TelegramConnector } from "./connectors/telegram.js";
import { ClaudeEvaluator } from "./ai/claude-evaluator.js";
import { Scheduler } from "./scheduler.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Database
const db = getDb();
const boardRepo = new BoardRepo(db);
const cardRepo = new CardRepo(db);
const settingsRepo = new SettingsRepo(db);

// Connectors
const registry = new ConnectorRegistry();
registry.register("gmail", new GmailConnector());
registry.register("calendar", new CalendarConnector());
registry.register("linear", new LinearConnector());
registry.register("gitlab", new GitLabConnector());
registry.register("telegram", new TelegramConnector());

// AI
const evaluator = new ClaudeEvaluator();

// Routes
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api/board", createBoardRouter(boardRepo, cardRepo));
app.use("/api/cards", createCardsRouter(cardRepo));
app.use("/api/ai", createAiRouter(cardRepo, evaluator, registry));
app.use("/api/settings", createSettingsRouter(settingsRepo));
app.use("/api/connectors", createConnectorsRouter(db));

// Scheduler
const pollInterval = settingsRepo.get("poll_interval_ms", 5 * 60 * 1000);
const scheduler = new Scheduler(registry, boardRepo, cardRepo);
scheduler.start(pollInterval);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

export default app;
```

**Step 2: Commit**

```bash
git add server/src/index.ts
git commit -m "feat: wire all connectors, AI, and scheduler into server"
```

---

### Task 27: End-to-End Smoke Test

**Files:**
- Create: `server/src/__tests__/e2e.test.ts`

**Step 1: Write an end-to-end test**

```typescript
// server/src/__tests__/e2e.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import Database from "better-sqlite3";
import { migrate } from "../db/migrate.js";
import { BoardRepo } from "../db/board-repo.js";
import { CardRepo } from "../db/card-repo.js";
import { createBoardRouter } from "../routes/board.js";
import { createCardsRouter } from "../routes/cards.js";

describe("E2E: Board workflow", () => {
  let app: express.Express;
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    migrate(db);
    const boardRepo = new BoardRepo(db);
    const cardRepo = new CardRepo(db);
    app = express();
    app.use(express.json());
    app.use("/api/board", createBoardRouter(boardRepo, cardRepo));
    app.use("/api/cards", createCardsRouter(cardRepo));
  });

  afterEach(() => {
    db.close();
  });

  it("full workflow: create board, add card, move through columns", async () => {
    // 1. Get today's board
    const boardRes = await request(app).get("/api/board/today");
    expect(boardRes.status).toBe(200);
    expect(boardRes.body.cards).toEqual([]);

    // 2. Create a manual card
    const cardRes = await request(app)
      .post("/api/cards")
      .send({ title: "Deploy API v2", body: "Push to production" });
    expect(cardRes.status).toBe(201);
    expect(cardRes.body.column_name).toBe("inbox");

    const cardId = cardRes.body.id;

    // 3. Move to human_do
    const moveRes = await request(app)
      .patch(`/api/cards/${cardId}/move`)
      .send({ column_name: "human_do" });
    expect(moveRes.body.column_name).toBe("human_do");

    // 4. Move to done
    const doneRes = await request(app)
      .patch(`/api/cards/${cardId}/move`)
      .send({ column_name: "done" });
    expect(doneRes.body.column_name).toBe("done");

    // 5. Verify board shows the card
    const finalBoard = await request(app).get("/api/board/today");
    expect(finalBoard.body.cards).toHaveLength(1);
    expect(finalBoard.body.cards[0].column_name).toBe("done");
  });
});
```

**Step 2: Run test**

Run: `cd /Users/shakedamar/Projects/daily-kanban && npx vitest run server/src/__tests__/e2e.test.ts`
Expected: PASS

**Step 3: Run all server tests**

Run: `cd /Users/shakedamar/Projects/daily-kanban && npx vitest run`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add server/src/__tests__/e2e.test.ts
git commit -m "test: add end-to-end smoke test for board workflow"
```

---

## Summary

| Phase | Tasks | What it delivers |
|-------|-------|-----------------|
| 1. Scaffolding | Tasks 1-4 | Monorepo, TypeScript, Vite+React+shadcn client, Express server |
| 2. Database | Task 5 | SQLite schema, migrations |
| 3. Backend API | Tasks 6-8 | Board & card CRUD, REST API |
| 4. Frontend UI | Tasks 9-13 | Kanban board with drag-and-drop, card creation |
| 5. Connectors | Tasks 14-15 | Connector interface, registry, polling scheduler |
| 6. AI Engine | Tasks 16-17 | Claude CLI evaluator, AI toggle wiring |
| 7. Connectors | Tasks 18-22 | Gmail, Calendar, Linear, GitLab, Telegram connectors |
| 8. Execution | Task 23 | AI Do column execution pipeline |
| 9. Settings | Tasks 24-25 | Settings page, connector configuration UI |
| 10. Integration | Tasks 26-27 | Full server wiring, E2E test |

**Total: 27 tasks, ~80 bite-sized steps.**
