import { Router } from "express";
import type { CardRepo } from "../db/card-repo.js";
import type { BoardRepo } from "../db/board-repo.js";
import type {
  CreateCardRequest,
  MoveCardRequest,
  ToggleAiRequest,
} from "@daily-kanban/shared";

export function createCardsRouter(
  cardRepo: CardRepo,
  boardRepo: BoardRepo
): Router {
  const router = Router();

  router.post("/", (req, res) => {
    const { title, body } = req.body as CreateCardRequest;
    const board = boardRepo.getOrCreateToday();

    const card = cardRepo.create({
      board_id: board.id,
      source_id: null,
      source_type: "manual",
      title,
      body: body || null,
      metadata: null,
    });
    res.status(201).json(card);
  });

  router.patch("/:id/move", (req, res) => {
    const id = Number(req.params.id);
    const { column_name, position } = req.body as MoveCardRequest;
    cardRepo.moveToColumn(id, column_name, position);
    const card = cardRepo.getById(id);
    res.json(card);
  });

  router.patch("/:id/ai-toggle", (req, res) => {
    const id = Number(req.params.id);
    const { ai_toggle } = req.body as ToggleAiRequest;
    cardRepo.setAiToggle(id, ai_toggle);
    const card = cardRepo.getById(id);
    res.json(card);
  });

  router.patch("/:id/repo", (req, res) => {
    const id = Number(req.params.id);
    const { repo_id } = req.body;
    cardRepo.setMetadataField(id, "repo_id", repo_id);
    const card = cardRepo.getById(id);
    res.json(card);
  });

  return router;
}
