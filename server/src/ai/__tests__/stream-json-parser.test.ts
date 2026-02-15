import { describe, it, expect, vi } from "vitest";
import { StreamJsonParser, type ParsedEvent } from "../stream-json-parser.js";

describe("StreamJsonParser", () => {
  it("extracts text deltas (bare format)", () => {
    const events: ParsedEvent[] = [];
    const parser = new StreamJsonParser((e) => events.push(e));

    parser.feed(JSON.stringify({
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" }
    }) + "\n");

    parser.feed(JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Hello world" }
    }) + "\n");

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "text", text: "Hello world" });
  });

  it("extracts text deltas from stream_event wrapper", () => {
    const events: ParsedEvent[] = [];
    const parser = new StreamJsonParser((e) => events.push(e));

    parser.feed(JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello wrapped" }
      }
    }) + "\n");

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "text", text: "Hello wrapped" });
  });

  it("detects tool_use start for AskUserQuestion", () => {
    const events: ParsedEvent[] = [];
    const parser = new StreamJsonParser((e) => events.push(e));

    parser.feed(JSON.stringify({
      type: "content_block_start",
      index: 1,
      content_block: { type: "tool_use", id: "tool_1", name: "AskUserQuestion", input: {} }
    }) + "\n");

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("tool_use_start");
    if (events[0].type === "tool_use_start") {
      expect(events[0].toolName).toBe("AskUserQuestion");
    }
  });

  it("accumulates tool input JSON deltas", () => {
    const events: ParsedEvent[] = [];
    const parser = new StreamJsonParser((e) => events.push(e));

    parser.feed(JSON.stringify({
      type: "content_block_start",
      index: 1,
      content_block: { type: "tool_use", id: "tool_1", name: "TaskCreate", input: {} }
    }) + "\n");

    parser.feed(JSON.stringify({
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: '{"subject":' }
    }) + "\n");

    parser.feed(JSON.stringify({
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: '"Do thing"}' }
    }) + "\n");

    parser.feed(JSON.stringify({
      type: "content_block_stop",
      index: 1
    }) + "\n");

    const toolComplete = events.find(e => e.type === "tool_use_complete");
    expect(toolComplete).toBeDefined();
    if (toolComplete?.type === "tool_use_complete") {
      expect(toolComplete.toolName).toBe("TaskCreate");
      expect(toolComplete.input).toEqual({ subject: "Do thing" });
    }
  });

  it("captures session_id from system init message", () => {
    const events: ParsedEvent[] = [];
    const parser = new StreamJsonParser((e) => events.push(e));

    parser.feed(JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "abc-123",
      tools: ["Bash", "Read"]
    }) + "\n");

    const initEvent = events.find(e => e.type === "init");
    expect(initEvent).toBeDefined();
    if (initEvent?.type === "init") {
      expect(initEvent.sessionId).toBe("abc-123");
    }
  });

  it("captures session_id from bare init message", () => {
    const events: ParsedEvent[] = [];
    const parser = new StreamJsonParser((e) => events.push(e));

    parser.feed(JSON.stringify({
      type: "init",
      session_id: "abc-123"
    }) + "\n");

    const initEvent = events.find(e => e.type === "init");
    expect(initEvent).toBeDefined();
    if (initEvent?.type === "init") {
      expect(initEvent.sessionId).toBe("abc-123");
    }
  });

  it("captures result event with subtype", () => {
    const events: ParsedEvent[] = [];
    const parser = new StreamJsonParser((e) => events.push(e));

    parser.feed(JSON.stringify({
      type: "result",
      subtype: "success",
      session_id: "abc-123",
      cost_usd: 0.001
    }) + "\n");

    const result = events.find(e => e.type === "result");
    expect(result).toBeDefined();
    if (result?.type === "result") {
      expect(result.status).toBe("success");
      expect(result.sessionId).toBe("abc-123");
    }
  });

  it("captures tool results from user messages", () => {
    const events: ParsedEvent[] = [];
    const parser = new StreamJsonParser((e) => events.push(e));

    parser.feed(JSON.stringify({
      type: "user",
      message: {
        content: [{
          type: "tool_result",
          tool_use_id: "toolu_abc123",
          content: "total 120\ndrwxr-xr-x  10 user  staff   320 Feb 15 ."
        }]
      }
    }) + "\n");

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("tool_result");
    if (events[0].type === "tool_result") {
      expect(events[0].toolUseId).toBe("toolu_abc123");
      expect(events[0].content).toContain("total 120");
    }
  });

  it("captures tool results with array content", () => {
    const events: ParsedEvent[] = [];
    const parser = new StreamJsonParser((e) => events.push(e));

    parser.feed(JSON.stringify({
      type: "user",
      message: {
        content: [{
          type: "tool_result",
          tool_use_id: "toolu_abc123",
          content: [{ type: "text", text: "file contents here" }]
        }]
      }
    }) + "\n");

    expect(events).toHaveLength(1);
    if (events[0].type === "tool_result") {
      expect(events[0].content).toBe("file contents here");
    }
  });

  it("extracts tool_use from assistant messages", () => {
    const events: ParsedEvent[] = [];
    const parser = new StreamJsonParser((e) => events.push(e));

    parser.feed(JSON.stringify({
      type: "assistant",
      message: {
        content: [{
          type: "tool_use",
          id: "toolu_xyz",
          name: "Bash",
          input: { command: "ls -la" }
        }]
      }
    }) + "\n");

    const toolComplete = events.find(e => e.type === "tool_use_complete");
    expect(toolComplete).toBeDefined();
    if (toolComplete?.type === "tool_use_complete") {
      expect(toolComplete.toolName).toBe("Bash");
      expect(toolComplete.input).toEqual({ command: "ls -la" });
    }
  });

  it("handles full Claude Code stream-json flow", () => {
    const events: ParsedEvent[] = [];
    const parser = new StreamJsonParser((e) => events.push(e));

    // System init
    parser.feed(JSON.stringify({ type: "system", subtype: "init", session_id: "sess-1", tools: [] }) + "\n");
    // Wrapped text streaming
    parser.feed(JSON.stringify({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } }) + "\n");
    parser.feed(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Let me " } } }) + "\n");
    parser.feed(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "check." } } }) + "\n");
    parser.feed(JSON.stringify({ type: "stream_event", event: { type: "content_block_stop", index: 0 } }) + "\n");
    // Tool use
    parser.feed(JSON.stringify({ type: "stream_event", event: { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t1", name: "Bash", input: {} } } }) + "\n");
    parser.feed(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"command":"ls"}' } } }) + "\n");
    parser.feed(JSON.stringify({ type: "stream_event", event: { type: "content_block_stop", index: 1 } }) + "\n");
    // Tool result
    parser.feed(JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "file1.txt\nfile2.txt" }] } }) + "\n");
    // Result
    parser.feed(JSON.stringify({ type: "result", subtype: "success", session_id: "sess-1" }) + "\n");

    const initEvents = events.filter(e => e.type === "init");
    const textEvents = events.filter(e => e.type === "text");
    const toolStartEvents = events.filter(e => e.type === "tool_use_start");
    const toolCompleteEvents = events.filter(e => e.type === "tool_use_complete");
    const toolResultEvents = events.filter(e => e.type === "tool_result");
    const resultEvents = events.filter(e => e.type === "result");

    expect(initEvents).toHaveLength(1);
    expect(textEvents).toHaveLength(2);
    expect(toolStartEvents).toHaveLength(1);
    expect(toolCompleteEvents).toHaveLength(1);
    expect(toolResultEvents).toHaveLength(1);
    expect(resultEvents).toHaveLength(1);

    if (toolResultEvents[0].type === "tool_result") {
      expect(toolResultEvents[0].content).toBe("file1.txt\nfile2.txt");
    }
  });

  it("handles multiple lines in a single feed", () => {
    const events: ParsedEvent[] = [];
    const parser = new StreamJsonParser((e) => events.push(e));

    const lines = [
      JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
      JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "A" } }),
      JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "B" } }),
    ].join("\n") + "\n";

    parser.feed(lines);
    expect(events.filter(e => e.type === "text")).toHaveLength(2);
  });

  it("handles partial lines across feeds (buffering)", () => {
    const events: ParsedEvent[] = [];
    const parser = new StreamJsonParser((e) => events.push(e));

    const full = JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } });
    // Split in the middle
    parser.feed(full.slice(0, 20));
    expect(events).toHaveLength(0);
    parser.feed(full.slice(20) + "\n");
    expect(events).toHaveLength(1);
  });

  it("ignores malformed JSON lines", () => {
    const events: ParsedEvent[] = [];
    const parser = new StreamJsonParser((e) => events.push(e));

    parser.feed("not json\n");
    parser.feed("{broken\n");
    expect(events).toHaveLength(0);
  });
});
