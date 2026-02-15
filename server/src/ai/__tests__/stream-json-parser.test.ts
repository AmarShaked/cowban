import { describe, it, expect, vi } from "vitest";
import { StreamJsonParser, type ParsedEvent } from "../stream-json-parser.js";

describe("StreamJsonParser", () => {
  it("extracts text deltas", () => {
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

  it("captures session_id from init message", () => {
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

  it("captures result event", () => {
    const events: ParsedEvent[] = [];
    const parser = new StreamJsonParser((e) => events.push(e));

    parser.feed(JSON.stringify({
      type: "result",
      status: "success",
      duration_ms: 5000,
      session_id: "abc-123"
    }) + "\n");

    const result = events.find(e => e.type === "result");
    expect(result).toBeDefined();
    if (result?.type === "result") {
      expect(result.status).toBe("success");
      expect(result.sessionId).toBe("abc-123");
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
