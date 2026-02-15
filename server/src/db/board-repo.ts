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
