// server/src/connectors/__tests__/telegram.test.ts
import { describe, it, expect } from "vitest";
import { TelegramConnector } from "../telegram.js";

describe("TelegramConnector", () => {
  it("transforms a text message into a KanbanItem", () => {
    const connector = new TelegramConnector();
    const item = connector.transformMessage({
      message_id: 42,
      date: 1739577600,
      chat: { id: 123, type: "private" },
      text: "Remember to deploy the API changes",
    });

    expect(item.source_id).toBe("telegram:42");
    expect(item.source_type).toBe("telegram");
    expect(item.title).toBe("Remember to deploy the API changes");
  });

  it("truncates long messages for title and puts full text in body", () => {
    const connector = new TelegramConnector();
    const longText = "A".repeat(200);
    const item = connector.transformMessage({
      message_id: 43,
      date: 1739577600,
      chat: { id: 123, type: "private" },
      text: longText,
    });

    expect(item.title.length).toBeLessThanOrEqual(103); // 100 + "..."
    expect(item.body).toBe(longText);
  });
});
