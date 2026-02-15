// server/src/connectors/__tests__/gmail.test.ts
import { describe, it, expect } from "vitest";
import { GmailConnector } from "../gmail.js";

describe("GmailConnector", () => {
  it("transforms gmail messages to KanbanItems", () => {
    const connector = new GmailConnector();
    const items = connector.transformMessages([
      {
        id: "msg_123",
        payload: {
          headers: [
            { name: "Subject", value: "Meeting tomorrow" },
            { name: "From", value: "alice@example.com" },
          ],
        },
        snippet: "Let's meet at 10am",
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0].source_id).toBe("gmail:msg_123");
    expect(items[0].source_type).toBe("gmail");
    expect(items[0].title).toBe("Meeting tomorrow");
    expect(items[0].metadata).toEqual({
      from: "alice@example.com",
      messageId: "msg_123",
    });
  });
});
