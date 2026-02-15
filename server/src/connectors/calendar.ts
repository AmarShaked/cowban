// server/src/connectors/calendar.ts
import { google } from "googleapis";
import type { Connector } from "./types.js";
import type { KanbanItem, ActionPayload, ActionResult } from "@daily-kanban/shared";

interface CalendarEvent {
  id: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  description?: string;
}

export class CalendarConnector implements Connector {
  name = "Calendar";
  icon = "calendar";
  private auth: any = null;

  setAuth(auth: any) {
    this.auth = auth;
  }

  transformEvents(events: CalendarEvent[]): KanbanItem[] {
    return events.map((evt) => ({
      source_id: `calendar:${evt.id}`,
      source_type: "calendar" as const,
      title: evt.summary || "(no title)",
      body: evt.description || null,
      metadata: {
        eventId: evt.id,
        start: evt.start?.dateTime || evt.start?.date || "",
        end: evt.end?.dateTime || evt.end?.date || "",
      },
    }));
  }

  async fetchItems(): Promise<KanbanItem[]> {
    if (!this.auth) return [];

    const calendar = google.calendar({ version: "v3", auth: this.auth });
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    const res = await calendar.events.list({
      calendarId: "primary",
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });

    return this.transformEvents((res.data.items || []) as CalendarEvent[]);
  }

  async executeAction(_item: KanbanItem, _action: ActionPayload): Promise<ActionResult> {
    return { success: false, message: "Calendar connector is read-only" };
  }
}
