import Database from "better-sqlite3";
import type { ExecutionSession } from "@daily-kanban/shared";

function rowToSession(row: Record<string, unknown>): ExecutionSession {
  return row as unknown as ExecutionSession;
}

export class SessionRepo {
  constructor(private db: Database.Database) {}

  create(
    cardId: number,
    type: string = "execution",
    summary?: string,
  ): ExecutionSession {
    const result = this.db
      .prepare(
        `INSERT INTO execution_sessions (card_id, type, status, summary)
         VALUES (?, ?, 'running', ?)`
      )
      .run(cardId, type, summary || null);

    return this.getById(Number(result.lastInsertRowid))!;
  }

  getById(id: number): ExecutionSession | null {
    const row = this.db
      .prepare("SELECT * FROM execution_sessions WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? rowToSession(row) : null;
  }

  updateStatus(id: number, status: string, summary?: string): void {
    if (summary !== undefined) {
      this.db
        .prepare(
          `UPDATE execution_sessions SET status = ?, finished_at = CURRENT_TIMESTAMP, summary = ? WHERE id = ?`
        )
        .run(status, summary, id);
    } else {
      this.db
        .prepare(
          `UPDATE execution_sessions SET status = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?`
        )
        .run(status, id);
    }
  }

  listByCard(cardId: number): ExecutionSession[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM execution_sessions WHERE card_id = ? ORDER BY started_at DESC"
      )
      .all(cardId) as Record<string, unknown>[];
    return rows.map(rowToSession);
  }
}
