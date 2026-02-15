// server/src/ai/claude-evaluator.ts
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { StreamJsonParser, type ParsedEvent } from "./stream-json-parser.js";
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

export interface ExecutionCallbacks {
  onText: (text: string) => void;
  onToolStart: (toolName: string) => void;
  onToolComplete: (toolName: string, input: Record<string, unknown>) => void;
  onInit: (sessionId: string) => void;
  onResult: (status: string, sessionId?: string) => void;
}

export class ClaudeEvaluator {
  private timeoutMs: number;

  constructor(timeoutMs: number = 30000) {
    this.timeoutMs = timeoutMs;
  }

  async evaluate(
    card: Card,
    availableActions: string[],
    customRequest?: string,
    connectorRules?: string,
  ): Promise<AiEvaluation> {
    const prompt = this.buildPrompt(card, availableActions, customRequest, connectorRules);

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

  async evaluateStream(
    card: Card,
    availableActions: string[],
    onChunk: (text: string) => void,
    customRequest?: string,
    connectorRules?: string,
  ): Promise<AiEvaluation> {
    const prompt = this.buildPrompt(card, availableActions, customRequest, connectorRules);

    return new Promise((resolve) => {
      const child = spawn("claude", ["-p", prompt, "--output-format", "json"], {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: this.timeoutMs,
      });

      let stdout = "";

      child.stdout.on("data", (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        onChunk(chunk);
      });

      child.stderr.on("data", (data: Buffer) => {
        console.error("Claude CLI stderr:", data.toString());
      });

      child.on("close", (code) => {
        if (code !== 0) {
          console.error(`Claude CLI exited with code ${code}`);
          resolve({
            canAutomate: false,
            confidence: 0,
            proposedAction: "AI evaluation failed",
            actionPayload: null,
          });
          return;
        }

        let responseText = stdout.trim();
        try {
          const wrapper = JSON.parse(responseText);
          if (wrapper.result) responseText = wrapper.result;
        } catch {
          // stdout is already the raw text
        }

        resolve(parseClaudeResponse(responseText));
      });

      child.on("error", (err) => {
        console.error("Claude CLI spawn error:", err);
        resolve({
          canAutomate: false,
          confidence: 0,
          proposedAction: "AI evaluation failed",
          actionPayload: null,
        });
      });
    });
  }

  async generatePlanStream(
    card: Card,
    repoName: string,
    repoPath: string,
    worktreePath: string,
    onChunk: (text: string) => void,
    customRequest?: string,
    connectorRules?: string,
  ): Promise<string> {
    let prompt = `Create a detailed implementation plan for this task.

Task: ${card.title}
Description: ${card.body || "(no description)"}
Repository: ${repoName} (${repoPath})`;

    if (connectorRules) {
      prompt += `\n\nDefault rules:\n${connectorRules}`;
    }
    if (customRequest) {
      prompt += `\n\nUser request: ${customRequest}`;
    }

    prompt += `\n\nReturn ONLY a detailed markdown plan listing the files to change and what to do in each. No JSON wrapping.`;

    return new Promise((resolve) => {
      const child = spawn("claude", ["-p", prompt], {
        cwd: worktreePath,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 60000,
      });

      let stdout = "";

      child.stdout.on("data", (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        onChunk(chunk);
      });

      child.stderr.on("data", (data: Buffer) => {
        console.error("Claude plan stderr:", data.toString());
      });

      child.on("close", (code) => {
        if (code !== 0) {
          console.error(`Claude plan exited with code ${code}`);
          resolve("Plan generation failed.");
          return;
        }

        // Try to unwrap JSON --output-format wrapper if present
        let result = stdout.trim();
        try {
          const wrapper = JSON.parse(result);
          if (wrapper.result) result = wrapper.result;
        } catch {
          // raw text, use as-is
        }

        resolve(result);
      });

      child.on("error", (err) => {
        console.error("Claude plan spawn error:", err);
        resolve("Plan generation failed.");
      });
    });
  }

  buildPrompt(card: Card, availableActions: string[], customRequest?: string, connectorRules?: string): string {
    let prompt = `You are evaluating a task item to determine if it can be automated.

Source: ${card.source_type}
Title: ${card.title}
Body: ${card.body || "(empty)"}
Metadata: ${JSON.stringify(card.metadata || {})}

Available actions for this source type: ${availableActions.join(", ")}`;

    if (connectorRules) {
      prompt += `\n\nDefault rules for this connector (always apply these unless the user request says otherwise):\n${connectorRules}`;
    }

    if (customRequest) {
      prompt += `\n\nUser request: ${customRequest}`;
    }

    prompt += `

Respond with ONLY a JSON object (no extra text):
{
  "canAutomate": boolean,
  "confidence": number (0-100),
  "proposedAction": "human-readable description of what you would do",
  "actionPayload": { "type": "action_type", ...params } or null
}

If you can confidently handle this with one of the available actions, set canAutomate to true and provide the action details. If not, set canAutomate to false.`;

    return prompt;
  }

  executeWithStreamJson(
    prompt: string,
    cwd: string,
    callbacks: ExecutionCallbacks,
    sessionId?: string,
  ): { child: import("child_process").ChildProcess; promise: Promise<void> } {
    const args = sessionId
      ? ["--resume", sessionId, "-p", prompt, "--output-format", "stream-json"]
      : ["-p", prompt, "--output-format", "stream-json", "--allowedTools", "Bash,Read,Write,Edit,Glob,Grep"];

    const child = spawn("claude", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 300000,
    });

    const parser = new StreamJsonParser((event: ParsedEvent) => {
      switch (event.type) {
        case "init":
          callbacks.onInit(event.sessionId);
          break;
        case "text":
          callbacks.onText(event.text);
          break;
        case "tool_use_start":
          callbacks.onToolStart(event.toolName);
          break;
        case "tool_use_complete":
          callbacks.onToolComplete(event.toolName, event.input);
          break;
        case "result":
          callbacks.onResult(event.status, event.sessionId);
          break;
      }
    });

    child.stdout!.on("data", (data: Buffer) => {
      parser.feed(data.toString());
    });

    child.stderr!.on("data", (data: Buffer) => {
      console.error("Claude execute stderr:", data.toString());
    });

    const promise = new Promise<void>((resolve) => {
      child.on("close", () => resolve());
      child.on("error", (err) => {
        console.error("Claude execute spawn error:", err);
        resolve();
      });
    });

    return { child, promise };
  }
}
