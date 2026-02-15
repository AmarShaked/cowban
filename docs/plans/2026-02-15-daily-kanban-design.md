# Daily Kanban — Design Document

**Date:** 2026-02-15
**Status:** Approved

## Overview

A local-first web app that aggregates daily tasks from multiple sources (Gmail, Google Calendar, Linear, GitLab, Telegram) into a kanban board. Claude CLI runs locally to evaluate items and propose automations. Users approve automations explicitly before execution. Each day starts with a fresh, blank board.

## Board & Columns

5 columns with left-to-right flow:

| Column | Purpose |
|--------|---------|
| **Inbox** | Items from connectors + manually created tasks. Each card has an opt-in "AI Review" toggle. |
| **Review** | Claude evaluated the item and proposed an automation. Shows what will happen if approved. |
| **AI Do** | User approved the automation. Claude executes it. |
| **Human Do** | User handles this themselves. |
| **Done** | Completed by AI or human. |

### Card Structure

- Source icon (Gmail/Calendar/Linear/GitLab/Telegram/Manual)
- Title (email subject, event name, issue title, MR title, etc.)
- Brief description / preview
- Timestamp
- Confidence score (Review column — how confident Claude is)
- Proposed action description (Review column — "Will reply with: ...")

### Interactions

- Inbox: enable AI toggle → Claude evaluates → moves to Review (if confidence >= threshold)
- Inbox → drag to Human Do (handle manually)
- Inbox → drag to Done (dismiss)
- Review → drag to AI Do (approve automation)
- Review → drag to Human Do (reject, handle manually)
- Human Do → drag to Done
- Manual card creation via "+" button
- No auto-start for AI — user must enable the toggle per item

## Connectors

Each connector implements a common interface:

```typescript
interface Connector {
  name: string;
  icon: string;
  fetchItems(): Promise<KanbanItem[]>;
  executeAction(item: KanbanItem, action: ActionPayload): Promise<ActionResult>;
}
```

### 5 Connectors for MVP

| Connector | Fetches | Action Capabilities |
|-----------|---------|-------------------|
| **Gmail** | Unread emails from today | Reply, archive, label |
| **Google Calendar** | Today's events | Read-only — summarize, prep notes |
| **Linear** | Issues in "Todo" status assigned to you | Update status, add comment, close |
| **GitLab** | MRs where you're assigned as reviewer | Post review comment, approve |
| **Telegram Bot** | Messages (text + audio) sent to your bot | Input-only — creates Inbox tasks |

### Telegram Bot Connector

- User creates a Telegram bot via BotFather, configures token in settings
- Bot listens for messages (text and voice/audio)
- Audio messages: transcribed via Whisper API or Claude audio capabilities
- All messages: processed by Claude CLI to extract structured task (title, description)
- Result appears as new Inbox card with source "Telegram"
- Input-only connector — no actions execute back to Telegram

### Auth & Configuration

- OAuth tokens / API keys stored encrypted in SQLite
- Settings page to configure/connect each service
- Per-connector enable/disable toggle

### Polling

- Background polling every 5-15 minutes (configurable per connector)
- Telegram uses long-polling or webhooks from Telegram Bot API
- Dedup via `source_id` (e.g., `gmail:msg_abc123`) — unique per board per day

## AI Evaluation & Automation Engine

### Evaluation Flow (when user enables AI toggle)

1. Backend spawns Claude CLI as child process
2. Passes structured prompt with: source type, title, body, metadata, available actions
3. Claude responds with:
   - `canAutomate: boolean`
   - `confidence: number (0-100)`
   - `proposedAction: string` — human-readable description
   - `actionPayload: object` — machine-readable action definition
4. If confidence >= threshold (configurable, default 80): card → Review
5. If below threshold: card stays in Inbox, toggle resets, tooltip explains

### Execution Flow (when user drags Review → AI Do)

1. Backend reads `actionPayload` from card
2. Calls connector's `executeAction(item, actionPayload)`
3. Success: card → Done with execution summary
4. Failure: card → Review with error message

### Safety

- Every AI action shows exactly what will happen before approval
- Email replies show full draft text
- MR comments show full comment text
- No action executes without explicit drag to "AI Do"

## Data Model

### SQLite Schema

```sql
-- One board per day
CREATE TABLE boards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date DATE UNIQUE NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Cards on the board
CREATE TABLE cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id INTEGER NOT NULL REFERENCES boards(id),
  source_id TEXT, -- e.g., "gmail:msg_abc123", unique per board
  source_type TEXT NOT NULL, -- gmail, calendar, linear, gitlab, telegram, manual
  column_name TEXT NOT NULL DEFAULT 'inbox', -- inbox, review, ai_do, human_do, done
  title TEXT NOT NULL,
  body TEXT,
  metadata JSON, -- source-specific data
  ai_toggle INTEGER DEFAULT 0,
  confidence REAL,
  proposed_action TEXT,
  action_payload JSON,
  execution_result TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(board_id, source_id)
);

-- Connector configurations
CREATE TABLE connector_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL UNIQUE,
  credentials JSON, -- encrypted OAuth tokens, API keys
  settings JSON, -- poll interval, filters, etc.
  enabled INTEGER DEFAULT 1
);

-- App settings
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value JSON
);
```

### Daily Reset

- On first load of a new day (or at midnight), create a new board if none exists for today
- No carryover from yesterday — hard reset
- Old boards remain in DB (potential history view later)
- Connectors poll immediately to populate Inbox

## Tech Stack

- **Frontend**: React + Vite + TypeScript + shadcn/ui + Tailwind CSS
- **Backend**: Node.js + Express + TypeScript
- **Database**: SQLite via `better-sqlite3` or Drizzle ORM
- **Claude**: Spawned via `child_process` CLI
- **Telegram**: `node-telegram-bot-api`
- **Google APIs**: `googleapis` (Gmail + Calendar)
- **Linear**: Linear SDK
- **GitLab**: GitLab REST API

## Project Structure

```
daily-kanban/
├── client/              # React + Vite SPA
│   ├── src/
│   │   ├── components/  # Board, Column, Card, Settings
│   │   ├── hooks/       # useBoard, useConnectors
│   │   ├── lib/         # API client, types
│   │   └── App.tsx
│   └── vite.config.ts
├── server/              # Express backend
│   ├── src/
│   │   ├── connectors/  # gmail.ts, calendar.ts, linear.ts, gitlab.ts, telegram.ts
│   │   ├── ai/          # claude-evaluator.ts
│   │   ├── db/          # schema.ts, migrations/
│   │   ├── routes/      # board.ts, cards.ts, connectors.ts, settings.ts
│   │   ├── scheduler.ts # Polling manager
│   │   └── index.ts
│   └── tsconfig.json
├── shared/              # Shared types between client & server
├── package.json         # npm workspaces root
└── README.md
```

Monorepo with npm workspaces — `client` and `server` as packages, `shared` for common types.

## Error Handling

- **Connector failures**: Logged, warning badge in UI. Other connectors unaffected. Expired tokens trigger re-auth prompt.
- **Claude CLI failures**: 30s timeout. Card stays in Inbox, toggle resets. Toast notification.
- **Duplicate handling**: Same `source_id` on same board = skip.
- **Offline/startup**: Existing board persists in SQLite. Polling resumes on restart.
