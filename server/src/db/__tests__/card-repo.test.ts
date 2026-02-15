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
