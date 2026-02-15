// server/src/ai/__tests__/claude-evaluator.test.ts
import { describe, it, expect } from "vitest";
import { parseClaudeResponse } from "../claude-evaluator.js";

describe("parseClaudeResponse", () => {
  it("parses a valid JSON response", () => {
    const raw = JSON.stringify({
      canAutomate: true,
      confidence: 90,
      proposedAction: "Reply to email",
      actionPayload: { type: "reply", body: "Got it!" },
    });
    const result = parseClaudeResponse(raw);
    expect(result.canAutomate).toBe(true);
    expect(result.confidence).toBe(90);
    expect(result.proposedAction).toBe("Reply to email");
  });

  it("parses JSON embedded in markdown code block", () => {
    const raw = `Here's my analysis:\n\`\`\`json\n{"canAutomate":true,"confidence":85,"proposedAction":"Archive email","actionPayload":{"type":"archive"}}\n\`\`\``;
    const result = parseClaudeResponse(raw);
    expect(result.canAutomate).toBe(true);
    expect(result.confidence).toBe(85);
  });

  it("returns cannot-automate for unparseable response", () => {
    const result = parseClaudeResponse("I don't know what to do with this");
    expect(result.canAutomate).toBe(false);
    expect(result.confidence).toBe(0);
  });
});
