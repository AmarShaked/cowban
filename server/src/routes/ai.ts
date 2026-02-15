// server/src/routes/ai.ts
import { Router } from "express";
import type { CardRepo } from "../db/card-repo.js";
import { ClaudeEvaluator } from "../ai/claude-evaluator.js";

const AVAILABLE_ACTIONS: Record<string, string[]> = {
  gmail: ["reply", "archive", "label"],
  calendar: ["summarize"],
  linear: ["update_status", "add_comment", "close"],
  gitlab: ["post_review_comment", "approve"],
  telegram: [],
  manual: [],
};

export function createAiRouter(
  cardRepo: CardRepo,
  evaluator: ClaudeEvaluator,
  confidenceThreshold: number = 80
): Router {
  const router = Router();

  router.post("/evaluate/:cardId", async (req, res) => {
    const cardId = Number(req.params.cardId);
    const card = cardRepo.getById(cardId);

    if (!card) {
      res.status(404).json({ error: "Card not found" });
      return;
    }

    const actions = AVAILABLE_ACTIONS[card.source_type] || [];
    const evaluation = await evaluator.evaluate(card, actions);

    if (evaluation.canAutomate && evaluation.confidence >= confidenceThreshold) {
      cardRepo.setAiEvaluation(cardId, {
        confidence: evaluation.confidence,
        proposed_action: evaluation.proposedAction,
        action_payload: evaluation.actionPayload,
      });
      cardRepo.moveToColumn(cardId, "review");
    } else {
      cardRepo.setAiToggle(cardId, false);
      cardRepo.setAiEvaluation(cardId, {
        confidence: evaluation.confidence,
        proposed_action: evaluation.proposedAction,
        action_payload: null,
      });
    }

    const updated = cardRepo.getById(cardId);
    res.json(updated);
  });

  return router;
}
