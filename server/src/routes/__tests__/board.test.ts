import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import Database from "better-sqlite3";
import { migrate } from "../../db/migrate.js";
import { createBoardRouter } from "../board.js";
import { createCardsRouter } from "../cards.js";
import { BoardRepo } from "../../db/board-repo.js";
import { CardRepo } from "../../db/card-repo.js";

describe("Board & Cards API", () => {
  let app: express.Express;
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    migrate(db);
    const boardRepo = new BoardRepo(db);
    const cardRepo = new CardRepo(db);

    app = express();
    app.use(express.json());
    app.use("/api/board", createBoardRouter(boardRepo, cardRepo));
    app.use("/api/cards", createCardsRouter(cardRepo, boardRepo));
  });

  afterEach(() => {
    db.close();
  });

  it("GET /api/board/today returns today's board with cards", async () => {
    const res = await request(app).get("/api/board/today");
    expect(res.status).toBe(200);
    expect(res.body.board.date).toBe(new Date().toISOString().split("T")[0]);
    expect(res.body.cards).toEqual([]);
  });

  it("POST /api/cards creates a manual card", async () => {
    // First create today's board
    await request(app).get("/api/board/today");

    const res = await request(app)
      .post("/api/cards")
      .send({ title: "My manual task", body: "Do this thing" });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe("My manual task");
    expect(res.body.source_type).toBe("manual");
    expect(res.body.column_name).toBe("inbox");
  });

  it("PATCH /api/cards/:id/move moves a card", async () => {
    await request(app).get("/api/board/today");
    const card = await request(app)
      .post("/api/cards")
      .send({ title: "Task" });

    const res = await request(app)
      .patch(`/api/cards/${card.body.id}/move`)
      .send({ column_name: "human_do" });
    expect(res.status).toBe(200);
    expect(res.body.column_name).toBe("human_do");
  });

  it("PATCH /api/cards/:id/ai-toggle toggles AI", async () => {
    await request(app).get("/api/board/today");
    const card = await request(app)
      .post("/api/cards")
      .send({ title: "Task" });

    const res = await request(app)
      .patch(`/api/cards/${card.body.id}/ai-toggle`)
      .send({ ai_toggle: true });
    expect(res.status).toBe(200);
    expect(res.body.ai_toggle).toBe(true);
  });
});
