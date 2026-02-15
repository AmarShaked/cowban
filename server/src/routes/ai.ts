// server/src/routes/ai.ts
import { Router } from "express";
import type Database from "better-sqlite3";
import type { KanbanItem, ActionPayload } from "@daily-kanban/shared";
import type { CardRepo } from "../db/card-repo.js";
import { ClaudeEvaluator } from "../ai/claude-evaluator.js";
import type { ConnectorRegistry } from "../connectors/registry.js";
import { WorktreeManager } from "../git/worktree-manager.js";
import type { SettingsRepo } from "../db/settings-repo.js";
import type { LogRepo } from "../db/log-repo.js";
import type { TodoItem, QuestionEvent } from "@daily-kanban/shared";

function summarizeToolInput(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "Bash":
      return `Bash: ${(input.command as string) || ""}`;
    case "Read":
      return `Read: ${(input.file_path as string) || ""}`;
    case "Write":
      return `Write: ${(input.file_path as string) || ""}`;
    case "Edit":
      return `Edit: ${(input.file_path as string) || ""}`;
    case "Glob":
      return `Glob: ${(input.pattern as string) || ""}`;
    case "Grep":
      return `Grep: ${(input.pattern as string) || ""} ${(input.path as string) || ""}`.trim();
    default:
      return `${toolName}(${Object.keys(input).join(", ")})`;
  }
}

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
  logRepo: LogRepo,
  confidenceThreshold: number = 80
): Router {
  const worktreeManager = new WorktreeManager();
  const router = Router();

  router.get("/logs/:cardId", (req, res) => {
    const cardId = Number(req.params.cardId);
    const logs = logRepo.listByCard(cardId);
    res.json({ logs });
  });

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

  router.post("/execute-code/:cardId", async (req, res) => {
    const cardId = Number(req.params.cardId);
    const card = cardRepo.getById(cardId);

    if (!card) {
      res.status(404).json({ error: "Card not found" });
      return;
    }

    const worktreePath = card.metadata?.worktree_path as string | undefined;
    const repoId = card.metadata?.repo_id as string | undefined;

    if (!worktreePath || !repoId) {
      res.status(400).json({ error: "Card has no worktree or repo assigned" });
      return;
    }

    const repos = settingsRepo.get<{ id: string; name: string; path: string }[]>("repos", []);
    const repo = repos.find((r) => r.id === repoId);

    if (!repo) {
      res.status(400).json({ error: "Assigned repo not found" });
      return;
    }

    // SSE setup
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const send = (data: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Clear any previous logs for this card before new execution
    logRepo.deleteByCard(cardId);
    cardRepo.setMetadataField(cardId, "execution_status", "running");

    const persistAndSend = (step: string, message: string, sessionId: string | null, data: Record<string, unknown> | null, extra?: Record<string, unknown>) => {
      logRepo.insert(cardId, step, message, sessionId, data);
      send({ step, message, ...extra, ...(data ? { data } : {}) });
    };

    try {
      persistAndSend("start", "Starting code execution...", null, null);
      persistAndSend("executing", `Running Claude Code in ${repo.name}...`, null, null);

      const plan = card.body || "";
      const prompt = `Execute this implementation plan in the current repository.\n\nPlan:\n${plan}\n\nImplement all changes described. Run tests if applicable.`;

      const existingSessionId = card.metadata?.session_id as string | undefined;
      let currentSessionId = existingSessionId || null;
      let textBuffer = "";
      let paused = false;

      const { child, promise } = evaluator.executeWithStreamJson(
        prompt,
        worktreePath,
        {
          onInit: (sessionId) => {
            currentSessionId = sessionId;
            cardRepo.setMetadataField(cardId, "session_id", sessionId);
          },
          onText: (text) => {
            textBuffer += text;
            if (textBuffer.length > 200 || text.includes("\n")) {
              persistAndSend("ai_output", textBuffer, currentSessionId, null);
              textBuffer = "";
            }
          },
          onToolStart: (toolName) => {
            if (textBuffer) {
              persistAndSend("ai_output", textBuffer, currentSessionId, null);
              textBuffer = "";
            }
            persistAndSend("tool_start", `Using: ${toolName}`, currentSessionId, { toolName });
          },
          onToolComplete: (toolName, input) => {
            if (toolName === "TaskCreate" || toolName === "TaskUpdate") {
              const todoData: Record<string, unknown> = {
                id: (input as Record<string, unknown>).subject || (input as Record<string, unknown>).taskId || "unknown",
                subject: (input as Record<string, unknown>).subject as string || "Task",
                status: (input as Record<string, unknown>).status as string || "pending",
              };
              persistAndSend("todo", `Task: ${todoData.subject}`, currentSessionId, todoData);
            } else if (toolName === "AskUserQuestion") {
              if (textBuffer) {
                persistAndSend("ai_output", textBuffer, currentSessionId, null);
                textBuffer = "";
              }
              const questions = (input.questions as Array<Record<string, unknown>>) || [];
              const firstQ = questions[0] || {};
              const questionData: Record<string, unknown> = {
                question: firstQ.question || "Claude needs your input",
                header: firstQ.header || "",
                options: firstQ.options || [],
                multiSelect: firstQ.multiSelect || false,
              };
              const logEntry = logRepo.insert(cardId, "question", questionData.question as string, currentSessionId, questionData);
              send({ step: "question", message: questionData.question as string, data: { ...questionData, questionId: logEntry.id } });
              cardRepo.setMetadataField(cardId, "execution_status", "paused_question");
              paused = true;
              child.kill("SIGTERM");
            } else {
              // Log the tool call with its input for visibility
              const summary = summarizeToolInput(toolName, input);
              persistAndSend("tool_complete", summary, currentSessionId, { toolName, input });
            }
          },
          onToolResult: (_toolUseId, content) => {
            // Truncate very long results for display
            const truncated = content.length > 2000 ? content.slice(0, 2000) + "\n... (truncated)" : content;
            persistAndSend("tool_result", truncated, currentSessionId, null);
          },
          onResult: (_status, sessionId) => {
            if (sessionId) {
              currentSessionId = sessionId;
              cardRepo.setMetadataField(cardId, "session_id", sessionId);
            }
          },
        },
        existingSessionId,
      );

      await promise;

      if (textBuffer) {
        persistAndSend("ai_output", textBuffer, currentSessionId, null);
        textBuffer = "";
      }

      if (paused) {
        res.end();
        return;
      }

      // Normal completion — commit, PR, cleanup
      persistAndSend("executing", "Committing changes...", currentSessionId, null);
      await worktreeManager.commit(worktreePath, `feat: ${card.title}`);

      persistAndSend("executing", "Creating pull request...", currentSessionId, null);
      let prUrl = "";
      try {
        prUrl = await worktreeManager.createPR(
          worktreePath,
          card.title,
          `## Summary\n\n${card.proposed_action}\n\n## Plan\n\n${plan}\n\n---\nGenerated by Daily Kanban AI`,
        );
        persistAndSend("executed", `PR created: ${prUrl}`, currentSessionId, null);
      } catch (err) {
        persistAndSend("error", `PR creation failed: ${(err as Error).message}`, currentSessionId, null);
      }

      persistAndSend("executing", "Cleaning up worktree...", currentSessionId, null);
      await worktreeManager.remove(worktreePath);
      cardRepo.setMetadataField(cardId, "worktree_path", null);

      cardRepo.setExecutionResult(cardId, prUrl ? `PR: ${prUrl}` : "Code changes committed");
      cardRepo.moveToColumn(cardId, "done");
      cardRepo.setMetadataField(cardId, "execution_status", "completed");

      const updated = cardRepo.getById(cardId);
      persistAndSend("done", prUrl ? `Done! PR: ${prUrl}` : "Done!", currentSessionId, null, { card: updated });
    } catch (err) {
      console.error("Execute-code error:", err);
      cardRepo.setMetadataField(cardId, "execution_status", "failed");
      persistAndSend("error", "Code execution failed", null, null);
      persistAndSend("done", "Execution failed", null, null, { card: cardRepo.getById(cardId) });
    }

    res.end();
  });

  router.post("/answer/:cardId", async (req, res) => {
    const cardId = Number(req.params.cardId);
    const card = cardRepo.getById(cardId);
    const { answer } = req.body as { answer: string };

    if (!card) {
      res.status(404).json({ error: "Card not found" });
      return;
    }

    const sessionId = card.metadata?.session_id as string | undefined;
    if (!sessionId) {
      res.status(400).json({ error: "No active session to resume" });
      return;
    }

    const worktreePath = card.metadata?.worktree_path as string | undefined;
    const repoId = card.metadata?.repo_id as string | undefined;
    if (!worktreePath || !repoId) {
      res.status(400).json({ error: "Card has no worktree or repo" });
      return;
    }

    const repos = settingsRepo.get<{ id: string; name: string; path: string }[]>("repos", []);
    const repo = repos.find((r) => r.id === repoId);
    if (!repo) {
      res.status(400).json({ error: "Assigned repo not found" });
      return;
    }

    logRepo.insert(cardId, "answer", answer, sessionId, null);

    // SSE setup — resuming execution
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const send = (data: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    cardRepo.setMetadataField(cardId, "execution_status", "running");

    const persistAndSend = (step: string, message: string, sid: string | null, data: Record<string, unknown> | null, extra?: Record<string, unknown>) => {
      logRepo.insert(cardId, step, message, sid, data);
      send({ step, message, ...extra, ...(data ? { data } : {}) });
    };

    try {
      persistAndSend("start", `Resuming with answer: "${answer}"`, sessionId, null);

      let currentSessionId = sessionId;
      let textBuffer = "";
      let paused = false;

      const { child, promise } = evaluator.executeWithStreamJson(
        answer,
        worktreePath,
        {
          onInit: (sid) => {
            currentSessionId = sid;
            cardRepo.setMetadataField(cardId, "session_id", sid);
          },
          onText: (text) => {
            textBuffer += text;
            if (textBuffer.length > 200 || text.includes("\n")) {
              persistAndSend("ai_output", textBuffer, currentSessionId, null);
              textBuffer = "";
            }
          },
          onToolStart: (toolName) => {
            if (textBuffer) {
              persistAndSend("ai_output", textBuffer, currentSessionId, null);
              textBuffer = "";
            }
            persistAndSend("tool_start", `Using: ${toolName}`, currentSessionId, { toolName });
          },
          onToolComplete: (toolName, input) => {
            if (toolName === "TaskCreate" || toolName === "TaskUpdate") {
              const todoData: Record<string, unknown> = {
                id: (input as Record<string, unknown>).subject || (input as Record<string, unknown>).taskId || "unknown",
                subject: (input as Record<string, unknown>).subject as string || "Task",
                status: (input as Record<string, unknown>).status as string || "pending",
              };
              persistAndSend("todo", `Task: ${todoData.subject}`, currentSessionId, todoData);
            } else if (toolName === "AskUserQuestion") {
              if (textBuffer) {
                persistAndSend("ai_output", textBuffer, currentSessionId, null);
                textBuffer = "";
              }
              const questions = (input.questions as Array<Record<string, unknown>>) || [];
              const firstQ = questions[0] || {};
              const questionData: Record<string, unknown> = {
                question: firstQ.question || "Claude needs your input",
                header: firstQ.header || "",
                options: firstQ.options || [],
                multiSelect: firstQ.multiSelect || false,
              };
              const logEntry = logRepo.insert(cardId, "question", questionData.question as string, currentSessionId, questionData);
              send({ step: "question", message: questionData.question as string, data: { ...questionData, questionId: logEntry.id } });
              cardRepo.setMetadataField(cardId, "execution_status", "paused_question");
              paused = true;
              child.kill("SIGTERM");
            } else {
              const summary = summarizeToolInput(toolName, input);
              persistAndSend("tool_complete", summary, currentSessionId, { toolName, input });
            }
          },
          onToolResult: (_toolUseId, content) => {
            const truncated = content.length > 2000 ? content.slice(0, 2000) + "\n... (truncated)" : content;
            persistAndSend("tool_result", truncated, currentSessionId, null);
          },
          onResult: (_status, sid) => {
            if (sid) {
              currentSessionId = sid;
              cardRepo.setMetadataField(cardId, "session_id", sid);
            }
          },
        },
        sessionId,
      );

      await promise;

      if (textBuffer) {
        persistAndSend("ai_output", textBuffer, currentSessionId, null);
      }

      if (paused) {
        res.end();
        return;
      }

      persistAndSend("executing", "Committing changes...", currentSessionId, null);
      await worktreeManager.commit(worktreePath, `feat: ${card.title}`);

      persistAndSend("executing", "Creating pull request...", currentSessionId, null);
      let prUrl = "";
      try {
        prUrl = await worktreeManager.createPR(
          worktreePath,
          card.title,
          `## Summary\n\n${card.proposed_action}\n\n## Plan\n\n${card.body || ""}\n\n---\nGenerated by Daily Kanban AI`,
        );
        persistAndSend("executed", `PR created: ${prUrl}`, currentSessionId, null);
      } catch (err) {
        persistAndSend("error", `PR creation failed: ${(err as Error).message}`, currentSessionId, null);
      }

      persistAndSend("executing", "Cleaning up worktree...", currentSessionId, null);
      await worktreeManager.remove(worktreePath);
      cardRepo.setMetadataField(cardId, "worktree_path", null);

      cardRepo.setExecutionResult(cardId, prUrl ? `PR: ${prUrl}` : "Code changes committed");
      cardRepo.moveToColumn(cardId, "done");
      cardRepo.setMetadataField(cardId, "execution_status", "completed");

      const updated = cardRepo.getById(cardId);
      persistAndSend("done", prUrl ? `Done! PR: ${prUrl}` : "Done!", currentSessionId, null, { card: updated });
    } catch (err) {
      console.error("Answer/resume error:", err);
      cardRepo.setMetadataField(cardId, "execution_status", "failed");
      persistAndSend("error", "Execution failed after resume", null, null);
      persistAndSend("done", "Execution failed", null, null, { card: cardRepo.getById(cardId) });
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
