# Execution UI: Logs, TODOs & Interactive Q&A

## Overview

Add three capabilities to the card detail panel for code execution cards:

1. **Persistent execution logs** — save all SSE events to DB so they can be viewed after execution completes
2. **TODO list from Claude** — display Claude Code's internal task tracking and markdown plan checklists
3. **Interactive Q&A** — when Claude asks a question during execution, pause, show it in the UI, let user answer, resume

## Approach: Resume-Based Q&A

Use `--output-format stream-json` to get structured NDJSON from Claude Code CLI. Parse events to extract text, tool calls (TaskCreate/Update, AskUserQuestion), and session IDs. On question detection, terminate the process and later resume with `claude --resume <session-id>`.

## Data Model

### New table: `execution_logs`

```sql
CREATE TABLE execution_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES cards(id),
  session_id TEXT,
  step TEXT NOT NULL,       -- start, ai_output, question, answer, todo, done, error
  message TEXT NOT NULL,
  data JSON,               -- structured: todo items, question options, etc.
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Card metadata additions

- `metadata.session_id` — Claude Code session ID for `--resume`
- `metadata.execution_status` — `running | paused_question | completed | failed`

No schema changes to the `cards` table.

## Server Architecture

### Stream-JSON Parsing

Replace raw stdout reading with NDJSON line-by-line parsing of `--output-format stream-json`:

- **Text deltas** (`content_block_delta` + `text_delta`) → `ai_output` log entries
- **Tool use** (`content_block_start` + `tool_use`) → detect `TaskCreate`, `TaskUpdate`, `AskUserQuestion`
- **Result** (`type: "result"`) → session complete

### Log Persistence

Every parsed event is inserted into `execution_logs` as it arrives.

### Question Flow

1. Detect `AskUserQuestion` tool call from stream-json events
2. Save question to `execution_logs` (step: `question`, data: options/header)
3. Set `metadata.execution_status = "paused_question"`
4. Send SSE `{step: "question", ...}` to client, end stream
5. Client shows question UI
6. User submits answer → `POST /api/ai/answer/:cardId`
7. Server persists answer, resumes: `claude --resume <session_id> -p "<answer>" --output-format stream-json`
8. Returns new SSE stream, continues execution

### New Endpoints

- `GET /api/ai/logs/:cardId` — fetch persisted logs for a card
- `POST /api/ai/answer/:cardId` — submit answer, resume execution (SSE response)

## Client UI

### A. Persistent Logs Viewer

- On panel open, fetch logs from `GET /api/ai/logs/:cardId` if card has execution history
- Same `LogEntry` visual style as live streaming
- Collapsible "Logs" section, expanded by default when logs exist
- During live execution, SSE events render as before AND persist

### B. TODO List Panel

Collapsible "Tasks" section with two sources:

1. **Claude Code tasks** — from `execution_logs` step=`todo`. Show subject + status (pending/in_progress/completed)
2. **Plan checklists** — parse `- [ ]`/`- [x]` from `card.body` markdown. Interactive checkboxes that update `card.body`

Live updates during execution as new todo events arrive.

### C. Question/Answer Interface

- On `question` event: highlighted card with question text, option buttons (if multiple choice), free-text input, "Submit" button
- On submit: calls answer endpoint, resumes SSE streaming
- Historical view: questions and answers shown inline in log timeline

## Files Changed

| Layer | File | Change |
|-------|------|--------|
| DB | `migrations/002_execution_logs.sql` | New table |
| DB | `card-repo.ts` | Log CRUD methods |
| Shared | `types.ts` | `ExecutionLog`, `TodoItem`, `QuestionEvent` types |
| Server | `ai/claude-evaluator.ts` | `executeWithStreamJson()` method |
| Server | `routes/ai.ts` | Update execute-code, add /logs, /answer |
| Client | `lib/api.ts` | `getExecutionLogs()`, `answerQuestion()` |
| Client | `hooks/useAiProcessing.ts` | Handle question/todo events, track state |
| Client | `components/CardDetailPanel.tsx` | Logs viewer, TODO section, Q&A UI |
