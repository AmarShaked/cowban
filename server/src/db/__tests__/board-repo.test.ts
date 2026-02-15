import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../migrate.js";
import { BoardRepo } from "../board-repo.js";

describe("BoardRepo", () => {
  let db: Database.Database;
  let repo: BoardRepo;

  beforeEach(() => {
    db = new Database(":memory:");
    migrate(db);
    repo = new BoardRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  it("getOrCreateToday creates a board for today", () => {
    const board = repo.getOrCreateToday();
    expect(board.date).toBe(new Date().toISOString().split("T")[0]);
  });

  it("getOrCreateToday returns existing board if already created", () => {
    const board1 = repo.getOrCreateToday();
    const board2 = repo.getOrCreateToday();
    expect(board1.id).toBe(board2.id);
  });
});
