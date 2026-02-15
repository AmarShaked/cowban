// server/src/connectors/gmail.ts
import { google } from "googleapis";
import type { Connector } from "./types.js";
import type { KanbanItem, ActionPayload, ActionResult } from "@daily-kanban/shared";

interface GmailMessage {
  id: string;
  payload?: {
    headers?: { name: string; value: string }[];
  };
  snippet?: string;
}

export class GmailConnector implements Connector {
  name = "Gmail";
  icon = "mail";
  private auth: any = null;

  setAuth(auth: any) {
    this.auth = auth;
  }

  transformMessages(messages: GmailMessage[]): KanbanItem[] {
    return messages.map((msg) => {
      const headers = msg.payload?.headers || [];
      const subject = headers.find((h) => h.name === "Subject")?.value || "(no subject)";
      const from = headers.find((h) => h.name === "From")?.value || "unknown";

      return {
        source_id: `gmail:${msg.id}`,
        source_type: "gmail",
        title: subject,
        body: msg.snippet || null,
        metadata: { from, messageId: msg.id },
      };
    });
  }

  async fetchItems(): Promise<KanbanItem[]> {
    if (!this.auth) return [];

    const gmail = google.gmail({ version: "v1", auth: this.auth });
    const today = new Date().toISOString().split("T")[0].replace(/-/g, "/");

    const res = await gmail.users.messages.list({
      userId: "me",
      q: `is:unread after:${today}`,
      maxResults: 50,
    });

    if (!res.data.messages) return [];

    const messages: GmailMessage[] = [];
    for (const msg of res.data.messages) {
      const full = await gmail.users.messages.get({
        userId: "me",
        id: msg.id!,
        format: "metadata",
        metadataHeaders: ["Subject", "From"],
      });
      messages.push(full.data as GmailMessage);
    }

    return this.transformMessages(messages);
  }

  async executeAction(item: KanbanItem, action: ActionPayload): Promise<ActionResult> {
    if (!this.auth) return { success: false, message: "Gmail not authenticated" };

    const gmail = google.gmail({ version: "v1", auth: this.auth });
    const messageId = item.metadata?.messageId as string;

    switch (action.type) {
      case "reply": {
        const raw = Buffer.from(
          `To: ${item.metadata?.from}\r\nSubject: Re: ${item.title}\r\nIn-Reply-To: ${messageId}\r\n\r\n${action.body}`
        ).toString("base64url");

        await gmail.users.messages.send({ userId: "me", requestBody: { raw, threadId: messageId } });
        return { success: true, message: `Replied to ${item.metadata?.from}` };
      }
      case "archive": {
        await gmail.users.messages.modify({
          userId: "me",
          id: messageId,
          requestBody: { removeLabelIds: ["INBOX"] },
        });
        return { success: true, message: "Email archived" };
      }
      case "delete": {
        await gmail.users.messages.trash({
          userId: "me",
          id: messageId,
        });
        return { success: true, message: "Email moved to trash" };
      }
      default:
        return { success: false, message: `Unknown action: ${action.type}` };
    }
  }
}
