# Code Agent: AI-Driven Code Changes via Kanban

## Overview

Add the ability for kanban cards to trigger autonomous code changes using Claude Code CLI. Each card can be assigned a repository. When moved to "In Process", the AI generates an implementation plan. After user approval, Claude Code executes the plan in an isolated git worktree, commits the changes, creates a PR, and cleans up.

## Flow

1. Card arrives in **Inbox** (from any source or manual)
2. User selects a repo in the detail panel (dropdown, default pre-selected)
3. User drags card to **In Process**
4. AI creates a git worktree, generates an implementation plan (streamed via SSE), saves the plan as markdown in `card.body`, moves card to **Review**
5. User reads the rendered markdown plan in the detail panel
6. User clicks **Execute** button
7. Claude Code CLI runs in the worktree (streamed via SSE), commits changes, creates a PR via `gh pr create`, removes the worktree, moves card to **Done** with PR link

## Data Model

No database migration needed. Everything fits in existing columns.

### Repos

Stored in the `settings` table under key `"repos"` as JSON:

```json
[{ "id": "uuid", "name": "daily-kanban", "path": "/Users/shakedamar/Projects/daily-kanban" }]
```

Default repo stored under key `"default_repo_id"` (a repo id or null).

### Per-Card Repo

Stored in the card's existing `metadata` JSON field as `metadata.repo_id`.

### Plan Content

Stored in `card.body` as markdown (overwritten when AI generates the plan). The `proposed_action` field stores a short summary.

### Worktree Tracking

`metadata.worktree_path` and `metadata.branch_name` track the active worktree. Cleaned up on completion.

## Worktree Management

**Branch naming:** `kanban/{cardId}-{slugified-title}`

**Worktree location:** `{repoParentDir}/worktrees/card-{id}` (sibling to the repo)

**Lifecycle:**
1. Plan phase start: `git worktree add ../worktrees/card-{id} -b {branch}`
2. Execute phase: Claude Code CLI runs scoped to worktree path
3. After commit + PR: `git worktree remove ../worktrees/card-{id}`
4. On error: worktree preserved for retry

**Safety:**
- Validate repo path exists and is a git repo
- Check branch name doesn't already exist
- Reuse existing worktree if retrying
- Store worktree metadata on card for cleanup after server restart

**Module:** `server/src/git/worktree-manager.ts`
- `create(repoPath, cardId, title)` -> `{ worktreePath, branchName }`
- `remove(worktreePath)`
- `commit(worktreePath, message)`
- `createPR(worktreePath, title, body)` — runs `gh pr create`

## Server Endpoints

### New

- `GET /api/repos` — list repos from settings
- `POST /api/repos` — add repo (validates path is a git repo)
- `DELETE /api/repos/:id` — remove a repo
- `PATCH /api/cards/:id/repo` — assign repo to card
- `POST /api/ai/execute-code/:cardId` — SSE stream: run Claude Code in worktree, commit, create PR

### Modified

- `POST /api/ai/process-stream/:cardId` — planning phase: when card has a `repo_id`, create worktree, spawn Claude for plan generation, save plan to body, move to review

## Claude Code Integration

### Planning Phase (60s timeout)

Spawns in worktree directory:
```
claude -p "Create an implementation plan for this task.
Task: {title}
Description: {body}
Repo: {repoName} ({repoPath})

Return a detailed markdown plan with file changes needed." --output-format json
```

Parses result, saves markdown plan to `card.body`. No code changes.

### Execution Phase (300s timeout)

Spawns in worktree directory:
```
claude -p "Execute this implementation plan in the current repository.
Plan:
{plan markdown}

Implement all changes described. Run tests if applicable." --allowedTools "Bash,Read,Write,Edit,Glob,Grep"
```

Streams stdout to client. After exit, worktree manager commits and creates PR.

### Error Handling

If Claude fails or times out, the worktree is preserved. Card stays in current column with error in logs. Retry button appears alongside Execute.

## UI Changes

### Card Detail Panel

- **Repo selector:** Dropdown below title. Lists configured repos, default pre-selected. Saves on change via `PATCH /api/cards/:id/repo`.
- **Plan display:** When card is in "review" and body contains markdown, render with `react-markdown`. Below the plan: **Execute** button triggers `execute-code` SSE stream.
- **Execution logs:** Same streaming log viewer as current processing.
- **Result:** When done with PR URL in `execution_result`, show as clickable link.

### Settings Page

New "Repositories" section:
- List of repos with name + path + delete button
- "Add Repository" form: name + path inputs + Add button
- Default repo dropdown below the list

### KanbanCard

No changes. Existing processing animation handles "In Process" state.

## Files to Create/Modify

| File | Change |
|------|--------|
| `server/src/git/worktree-manager.ts` | **New** — worktree create/remove/commit/PR |
| `server/src/routes/repos.ts` | **New** — CRUD for repo settings |
| `server/src/routes/ai.ts` | Modify process-stream for plan phase, add execute-code endpoint |
| `server/src/ai/claude-evaluator.ts` | Add plan generation method |
| `server/src/index.ts` | Mount repos router |
| `client/src/lib/api.ts` | Add repo + execute-code API methods |
| `client/src/components/CardDetailPanel.tsx` | Repo selector, markdown plan viewer, execute button |
| `client/src/components/Settings.tsx` | Repos management section |
| `client/package.json` | Add `react-markdown` dependency |
