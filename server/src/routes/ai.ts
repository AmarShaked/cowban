// server/src/routes/ai.ts
import { Router } from "express";
import type { KanbanItem, ActionPayload } from "@daily-kanban/shared";
import type { CardRepo } from "../db/card-repo.js";
import { ClaudeEvaluator } from "../ai/claude-evaluator.js";
import type { ConnectorRegistry } from "../connectors/registry.js";

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
  registry: ConnectorRegistry,
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

  router.post("/execute/:cardId", async (req, res) => {
    const cardId = Number(req.params.cardId);
    const card = cardRepo.getById(cardId);

    if (!card) {
      res.status(404).json({ error: "Card not found" });
      return;
    }

    if (!card.action_payload) {
      res.status(400).json({ error: "No action payload" });
      return;
    }

    const connector = registry.get(card.source_type);
    if (!connector) {
      res.status(400).json({ error: `No connector for ${card.source_type}` });
      return;
    }

    const item: KanbanItem = {
      source_id: card.source_id!,
      source_type: card.source_type,
      title: card.title,
      body: card.body,
      metadata: card.metadata || {},
    };

    const result = await connector.executeAction(item, card.action_payload as ActionPayload);

    if (result.success) {
      cardRepo.setExecutionResult(cardId, result.message);
      cardRepo.moveToColumn(cardId, "done");
    } else {
      cardRepo.setExecutionResult(cardId, `Failed: ${result.message}`);
      cardRepo.moveToColumn(cardId, "review");
    }

    const updated = cardRepo.getById(cardId);
    res.json(updated);
  });

  return router;
}
