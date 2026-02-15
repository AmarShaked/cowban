// server/src/routes/ai.ts
import { Router } from "express";
import type Database from "better-sqlite3";
import type { KanbanItem, ActionPayload } from "@daily-kanban/shared";
import type { CardRepo } from "../db/card-repo.js";
import { ClaudeEvaluator } from "../ai/claude-evaluator.js";
import type { ConnectorRegistry } from "../connectors/registry.js";
import { WorktreeManager } from "../git/worktree-manager.js";
import type { SettingsRepo } from "../db/settings-repo.js";

const AVAILABLE_ACTIONS: Record<string, string[]> = {
  gmail: ["reply", "archive", "delete", "label"],
  calendar: ["summarize"],
  linear: ["update_status", "add_comment", "close"],
  gitlab: ["post_review_comment", "approve"],
  telegram: [],
  manual: [],
};

function getAiRules(db: Database.Database, sourceType: string): string | undefined {
  const row = db.prepare(
    "SELECT settings FROM connector_configs WHERE type = ?"
  ).get(sourceType) as { settings: string | null } | undefined;
  if (!row?.settings) return undefined;
  try {
    const settings = JSON.parse(row.settings);
    return settings.ai_rules || undefined;
  } catch {
    return undefined;
  }
}

export function createAiRouter(
  cardRepo: CardRepo,
  evaluator: ClaudeEvaluator,
  registry: ConnectorRegistry,
  db: Database.Database,
  settingsRepo: SettingsRepo,
  confidenceThreshold: number = 80
): Router {
  const worktreeManager = new WorktreeManager();
  const router = Router();

  router.post("/evaluate/:cardId", async (req, res) => {
    const cardId = Number(req.params.cardId);
    const card = cardRepo.getById(cardId);

    if (!card) {
      res.status(404).json({ error: "Card not found" });
      return;
    }

    const actions = AVAILABLE_ACTIONS[card.source_type] || [];
    const aiRules = getAiRules(db, card.source_type);
    const evaluation = await evaluator.evaluate(card, actions, undefined, aiRules);

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

  router.post("/process-stream/:cardId", async (req, res) => {
    const cardId = Number(req.params.cardId);
    const card = cardRepo.getById(cardId);
    const customRequest = req.body?.customRequest as string | undefined;

    if (!card) {
      res.status(404).json({ error: "Card not found" });
      return;
    }

    // Set up SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const send = (data: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      send({ step: "start", message: customRequest ? `Starting AI evaluation: "${customRequest}"` : "Starting AI evaluation..." });

      // Toggle AI on
      cardRepo.setAiToggle(cardId, true);

      // Check if card has a repo assigned — if so, do code planning instead of normal eval
      const repoId = card.metadata?.repo_id as string | undefined;
      if (repoId) {
        const repos = settingsRepo.get<{ id: string; name: string; path: string }[]>("repos", []);
        const repo = repos.find((r) => r.id === repoId);

        if (!repo) {
          send({ step: "error", message: "Assigned repo not found" });
          send({ step: "done", message: "Processing failed", card: cardRepo.getById(cardId) });
          res.end();
          return;
        }

        send({ step: "evaluating", message: `Creating worktree for ${repo.name}...` });

        const { worktreePath, branchName } = await worktreeManager.create(repo.path, cardId, card.title);
        cardRepo.setMetadataField(cardId, "worktree_path", worktreePath);
        cardRepo.setMetadataField(cardId, "branch_name", branchName);

        send({ step: "evaluating", message: "Generating implementation plan..." });

        const aiRules = getAiRules(db, card.source_type);
        const plan = await evaluator.generatePlanStream(
          card, repo.name, repo.path, worktreePath, (chunk) => {
            send({ step: "ai_output", message: chunk });
          }, customRequest, aiRules,
        );

        // Save plan to card body and move to review
        cardRepo.setBody(cardId, plan);
        cardRepo.setAiEvaluation(cardId, {
          confidence: 100,
          proposed_action: `Code change plan for ${repo.name}`,
          action_payload: { type: "code_change", repo_id: repoId },
        });
        cardRepo.moveToColumn(cardId, "review");

        const updated = cardRepo.getById(cardId);
        send({ step: "done", message: "Plan ready for review", card: updated });
        res.end();
        return;
      }

      send({ step: "evaluating", message: "Analyzing task with AI..." });

      const actions = AVAILABLE_ACTIONS[card.source_type] || [];
      const aiRules = getAiRules(db, card.source_type);
      const evaluation = await evaluator.evaluateStream(card, actions, (chunk) => {
        send({ step: "ai_output", message: chunk });
      }, customRequest, aiRules);

      send({
        step: "evaluated",
        message: `Confidence: ${evaluation.confidence}%, Action: ${evaluation.proposedAction}`,
      });

      // Save evaluation to DB
      cardRepo.setAiEvaluation(cardId, {
        confidence: evaluation.confidence,
        proposed_action: evaluation.proposedAction,
        action_payload: evaluation.actionPayload,
      });

      if (evaluation.canAutomate && evaluation.confidence >= confidenceThreshold) {
        cardRepo.moveToColumn(cardId, "review");

        send({ step: "executing", message: "Executing action..." });

        const connector = registry.get(card.source_type);
        if (connector && card.action_payload) {
          const item: KanbanItem = {
            source_id: card.source_id!,
            source_type: card.source_type,
            title: card.title,
            body: card.body,
            metadata: card.metadata || {},
          };

          const result = await connector.executeAction(
            item,
            evaluation.actionPayload as ActionPayload,
          );

          if (result.success) {
            cardRepo.setExecutionResult(cardId, result.message);
            cardRepo.moveToColumn(cardId, "done");
            send({ step: "executed", message: result.message });
          } else {
            cardRepo.setExecutionResult(cardId, `Failed: ${result.message}`);
            cardRepo.moveToColumn(cardId, "review");
            send({ step: "error", message: `Execution failed: ${result.message}` });
          }
        } else {
          // High confidence but no connector or payload — just move to review
          send({ step: "executed", message: "Moved to review for manual execution" });
        }
      } else {
        cardRepo.setAiToggle(cardId, false);
        send({ step: "low_confidence", message: "Confidence too low for automation" });
      }

      const updated = cardRepo.getById(cardId);
      send({ step: "done", message: "Processing complete", card: updated });
    } catch (err) {
      console.error("AI process-stream error:", err);
      send({ step: "error", message: "AI processing failed" });
      send({ step: "done", message: "Processing failed", card: cardRepo.getById(cardId) });
    }

    res.end();
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
