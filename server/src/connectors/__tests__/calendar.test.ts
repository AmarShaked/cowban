// server/src/connectors/__tests__/calendar.test.ts
import { describe, it, expect } from "vitest";
import { CalendarConnector } from "../calendar.js";

describe("CalendarConnector", () => {
  it("transforms calendar events to KanbanItems", () => {
    const connector = new CalendarConnector();
    const items = connector.transformEvents([
      {
        id: "evt_1",
        summary: "Team standup",
        start: { dateTime: "2026-02-15T10:00:00Z" },
        end: { dateTime: "2026-02-15T10:30:00Z" },
        description: "Daily sync",
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0].source_id).toBe("calendar:evt_1");
    expect(items[0].title).toBe("Team standup");
    expect(items[0].metadata).toMatchObject({
      eventId: "evt_1",
      start: "2026-02-15T10:00:00Z",
      end: "2026-02-15T10:30:00Z",
    });
  });
});
