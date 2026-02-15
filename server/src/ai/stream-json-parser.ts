export type ParsedEvent =
  | { type: "init"; sessionId: string }
  | { type: "text"; text: string }
  | { type: "tool_use_start"; toolName: string; toolId: string; index: number }
  | { type: "tool_use_complete"; toolName: string; toolId: string; input: Record<string, unknown> }
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
        this.processObject(obj);
      } catch {
        // Skip malformed JSON
      }
    }
  }

  private processObject(obj: Record<string, unknown>): void {
    const type = obj.type as string;

    if (type === "init") {
      this.onEvent({ type: "init", sessionId: obj.session_id as string });
      return;
    }

    if (type === "result") {
      this.onEvent({
        type: "result",
        status: obj.status as string,
        sessionId: obj.session_id as string | undefined,
        durationMs: obj.duration_ms as number | undefined,
      });
      return;
    }

    if (type === "content_block_start") {
      const block = obj.content_block as Record<string, unknown>;
      if (block?.type === "tool_use") {
        const index = obj.index as number;
        const toolName = block.name as string;
        const toolId = block.id as string;
        this.activeTools.set(index, { name: toolName, id: toolId, index, jsonChunks: [] });
        this.onEvent({ type: "tool_use_start", toolName, toolId, index });
      }
      return;
    }

    if (type === "content_block_delta") {
      const delta = obj.delta as Record<string, unknown>;
      if (delta?.type === "text_delta") {
        this.onEvent({ type: "text", text: delta.text as string });
      } else if (delta?.type === "input_json_delta") {
        const index = obj.index as number;
        const tool = this.activeTools.get(index);
        if (tool) {
          tool.jsonChunks.push(delta.partial_json as string);
        }
      }
      return;
    }

    if (type === "content_block_stop") {
      const index = obj.index as number;
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
