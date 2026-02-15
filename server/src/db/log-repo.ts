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
