import { Router } from "express";
import type { BoardRepo } from "../db/board-repo.js";
import type { CardRepo } from "../db/card-repo.js";

export function createBoardRouter(
  boardRepo: BoardRepo,
  cardRepo: CardRepo
): Router {
  const router = Router();

  router.get("/today", (_req, res) => {
    const board = boardRepo.getOrCreateToday();
    const cards = cardRepo.listByBoard(board.id);
    res.json({ board, cards });
  });

  router.delete("/today", (_req, res) => {
    const board = boardRepo.getOrCreateToday();
    const deleted = cardRepo.deleteAllByBoard(board.id);
    res.json({ success: true, deleted });
  });

  return router;
}
