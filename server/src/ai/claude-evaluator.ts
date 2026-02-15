// server/src/ai/claude-evaluator.ts
import { execFile } from "child_process";
import { promisify } from "util";
import type { Card, AiEvaluation } from "@daily-kanban/shared";

const execFileAsync = promisify(execFile);

export function parseClaudeResponse(raw: string): AiEvaluation {
  // First, try parsing the entire string as JSON
  try {
    const parsed = JSON.parse(raw);
    return validateEvaluation(parsed);
  } catch {
    // Not valid JSON; try extracting from markdown code block
    const jsonMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1].trim());
        return validateEvaluation(parsed);
      } catch {
        // fall through
      }
    }
  }

  return {
    canAutomate: false,
    confidence: 0,
    proposedAction: "Could not evaluate this item",
    actionPayload: null,
  };
}

function validateEvaluation(obj: Record<string, unknown>): AiEvaluation {
  return {
    canAutomate: Boolean(obj.canAutomate),
    confidence: typeof obj.confidence === "number" ? obj.confidence : 0,
    proposedAction:
      typeof obj.proposedAction === "string" ? obj.proposedAction : "",
    actionPayload:
      (obj.actionPayload as AiEvaluation["actionPayload"]) ?? null,
  };
}

export class ClaudeEvaluator {
  private timeoutMs: number;

  constructor(timeoutMs: number = 30000) {
    this.timeoutMs = timeoutMs;
  }

  async evaluate(
    card: Card,
    availableActions: string[],
  ): Promise<AiEvaluation> {
    const prompt = this.buildPrompt(card, availableActions);

    try {
      const { stdout } = await execFileAsync(
        "claude",
        ["-p", prompt, "--output-format", "json"],
        { timeout: this.timeoutMs },
      );

      let responseText = stdout.trim();
      try {
        const wrapper = JSON.parse(responseText);
        if (wrapper.result) responseText = wrapper.result;
      } catch {
        // stdout is already the raw text
      }

      return parseClaudeResponse(responseText);
    } catch (err) {
      console.error("Claude CLI evaluation failed:", err);
      return {
        canAutomate: false,
        confidence: 0,
        proposedAction: "AI evaluation failed",
        actionPayload: null,
      };
    }
  }

  private buildPrompt(card: Card, availableActions: string[]): string {
    return `You are evaluating a task item to determine if it can be automated.

Source: ${card.source_type}
Title: ${card.title}
Body: ${card.body || "(empty)"}
Metadata: ${JSON.stringify(card.metadata || {})}

Available actions for this source type: ${availableActions.join(", ")}

Respond with ONLY a JSON object (no extra text):
{
  "canAutomate": boolean,
  "confidence": number (0-100),
  "proposedAction": "human-readable description of what you would do",
  "actionPayload": { "type": "action_type", ...params } or null
}

If you can confidently handle this with one of the available actions, set canAutomate to true and provide the action details. If not, set canAutomate to false.`;
  }
}
