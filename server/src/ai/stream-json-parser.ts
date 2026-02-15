export type ParsedEvent =
  | { type: "init"; sessionId: string }
  | { type: "text"; text: string }
  | { type: "tool_use_start"; toolName: string; toolId: string; index: number }
  | { type: "tool_use_complete"; toolName: string; toolId: string; input: Record<string, unknown> }
  | { type: "tool_result"; toolUseId: string; content: string }
  | { type: "result"; status: string; sessionId?: string; durationMs?: number };

interface ToolAccumulator {
  name: string;
  id: string;
  index: number;
  jsonChunks: string[];
}

export class StreamJsonParser {
  private buffer = "";
  private activeTools = new Map<number, ToolAccumulator>();

  constructor(private onEvent: (event: ParsedEvent) => void) {}

  feed(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    // Keep the last (possibly incomplete) line in the buffer
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed);
        this.processTopLevel(obj);
      } catch {
        // Skip malformed JSON
      }
    }
  }

  private processTopLevel(obj: Record<string, unknown>): void {
    const type = obj.type as string;

    // Claude Code wraps API events in {"type":"stream_event","event":{...}}
    if (type === "stream_event") {
      const event = obj.event as Record<string, unknown>;
      if (event) {
        this.processStreamEvent(event);
      }
      return;
    }

    // {"type":"system","subtype":"init","session_id":"..."}
    if (type === "system") {
      if (obj.subtype === "init" && obj.session_id) {
        this.onEvent({ type: "init", sessionId: obj.session_id as string });
      }
      return;
    }

    // {"type":"user","message":{"content":[{"type":"tool_result",...}]}}
    if (type === "user") {
      const message = obj.message as Record<string, unknown>;
      if (message) {
        const content = message.content as Array<Record<string, unknown>>;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "tool_result") {
              const resultContent = typeof block.content === "string"
                ? block.content
                : Array.isArray(block.content)
                  ? (block.content as Array<Record<string, unknown>>)
                      .map((c) => (c.text as string) || "")
                      .join("")
                  : JSON.stringify(block.content);
              this.onEvent({
                type: "tool_result",
                toolUseId: block.tool_use_id as string,
                content: resultContent,
              });
            }
          }
        }
      }
      return;
    }

    // {"type":"assistant","message":{"content":[...]}} — complete assembled message
    // We extract tool_use blocks from completed assistant messages too
    if (type === "assistant") {
      const message = obj.message as Record<string, unknown>;
      if (message) {
        const content = message.content as Array<Record<string, unknown>>;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "tool_use") {
              // Emit as a complete tool use (in case we missed the streaming version)
              this.onEvent({
                type: "tool_use_complete",
                toolName: block.name as string,
                toolId: block.id as string,
                input: (block.input as Record<string, unknown>) || {},
              });
            }
          }
        }
      }
      return;
    }

    // {"type":"result","subtype":"success","session_id":"..."}
    if (type === "result") {
      this.onEvent({
        type: "result",
        status: (obj.subtype as string) || (obj.status as string) || "unknown",
        sessionId: obj.session_id as string | undefined,
        durationMs: obj.duration_ms as number | undefined,
      });
      return;
    }

    // Also handle bare API events (no stream_event wrapper) for backwards compat
    if (type === "content_block_start" || type === "content_block_delta" ||
        type === "content_block_stop" || type === "message_start" ||
        type === "message_delta" || type === "message_stop") {
      this.processStreamEvent(obj);
      return;
    }

    // {"type":"init","session_id":"..."} — bare init (older format)
    if (type === "init" && obj.session_id) {
      this.onEvent({ type: "init", sessionId: obj.session_id as string });
      return;
    }
  }

  private processStreamEvent(event: Record<string, unknown>): void {
    const type = event.type as string;

    if (type === "content_block_start") {
      const block = event.content_block as Record<string, unknown>;
      if (block?.type === "tool_use") {
        const index = event.index as number;
        const toolName = block.name as string;
        const toolId = block.id as string;
        this.activeTools.set(index, { name: toolName, id: toolId, index, jsonChunks: [] });
        this.onEvent({ type: "tool_use_start", toolName, toolId, index });
      }
      return;
    }

    if (type === "content_block_delta") {
      const delta = event.delta as Record<string, unknown>;
      if (delta?.type === "text_delta") {
        this.onEvent({ type: "text", text: delta.text as string });
      } else if (delta?.type === "input_json_delta") {
        const index = event.index as number;
        const tool = this.activeTools.get(index);
        if (tool) {
          tool.jsonChunks.push(delta.partial_json as string);
        }
      }
      return;
    }

    if (type === "content_block_stop") {
      const index = event.index as number;
      const tool = this.activeTools.get(index);
      if (tool) {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(tool.jsonChunks.join(""));
        } catch {
          // Malformed tool input
        }
        this.onEvent({ type: "tool_use_complete", toolName: tool.name, toolId: tool.id, input });
        this.activeTools.delete(index);
      }
      return;
    }
  }
}
