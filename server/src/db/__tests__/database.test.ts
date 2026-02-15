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
