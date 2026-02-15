import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import Database from "better-sqlite3";
import { migrate } from "../db/migrate.js";
import { BoardRepo } from "../db/board-repo.js";
import { CardRepo } from "../db/card-repo.js";
import { createBoardRouter } from "../routes/board.js";
import { createCardsRouter } from "../routes/cards.js";

describe("E2E: Board workflow", () => {
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

  it("full workflow: create board, add card, move through columns", async () => {
    // 1. Get today's board
    const boardRes = await request(app).get("/api/board/today");
    expect(boardRes.status).toBe(200);
    expect(boardRes.body.cards).toEqual([]);

    // 2. Create a manual card
    const cardRes = await request(app)
      .post("/api/cards")
      .send({ title: "Deploy API v2", body: "Push to production" });
    expect(cardRes.status).toBe(201);
    expect(cardRes.body.column_name).toBe("inbox");

    const cardId = cardRes.body.id;

    // 3. Move to human_do
    const moveRes = await request(app)
      .patch(`/api/cards/${cardId}/move`)
      .send({ column_name: "human_do" });
    expect(moveRes.body.column_name).toBe("human_do");

    // 4. Move to done
    const doneRes = await request(app)
      .patch(`/api/cards/${cardId}/move`)
      .send({ column_name: "done" });
    expect(doneRes.body.column_name).toBe("done");

    // 5. Verify board shows the card
    const finalBoard = await request(app).get("/api/board/today");
    expect(finalBoard.body.cards).toHaveLength(1);
    expect(finalBoard.body.cards[0].column_name).toBe("done");
  });
});
