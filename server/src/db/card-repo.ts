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
    const maxPos = this.db
      .prepare("SELECT COALESCE(MAX(position), 0) as max_pos FROM cards WHERE board_id = ?")
      .get(input.board_id) as { max_pos: number };
    const position = maxPos.max_pos + 1;

    const result = this.db
      .prepare(
        `INSERT INTO cards (board_id, source_id, source_type, title, body, metadata, position)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.board_id,
        input.source_id,
        input.source_type,
        input.title,
        input.body,
        input.metadata ? JSON.stringify(input.metadata) : null,
        position
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
      .prepare("SELECT * FROM cards WHERE board_id = ? ORDER BY position ASC, created_at ASC")
      .all(boardId) as Record<string, unknown>[];
    return rows.map(rowToCard);
  }

  moveToColumn(id: number, column: ColumnName, position?: number): void {
    if (position === undefined) {
      const maxPos = this.db
        .prepare("SELECT COALESCE(MAX(position), 0) as max_pos FROM cards WHERE board_id = (SELECT board_id FROM cards WHERE id = ?)")
        .get(id) as { max_pos: number };
      position = maxPos.max_pos + 1;
    }
    this.db
      .prepare("UPDATE cards SET column_name = ?, position = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(column, position, id);
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

  setBody(id: number, body: string): void {
    this.db
      .prepare("UPDATE cards SET body = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(body, id);
  }

  setMetadataField(id: number, key: string, value: unknown): void {
    const card = this.getById(id);
    if (!card) return;
    const metadata = card.metadata || {};
    metadata[key] = value;
    this.db
      .prepare("UPDATE cards SET metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(JSON.stringify(metadata), id);
  }

  deleteAllByBoard(boardId: number): number {
    const result = this.db
      .prepare("DELETE FROM cards WHERE board_id = ?")
      .run(boardId);
    return result.changes;
  }
}
