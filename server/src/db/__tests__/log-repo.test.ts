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
