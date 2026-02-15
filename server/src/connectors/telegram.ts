// server/src/connectors/telegram.ts
import TelegramBot from "node-telegram-bot-api";
import type { Connector } from "./types.js";
import type { KanbanItem, ActionPayload, ActionResult } from "@daily-kanban/shared";
import type { CardRepo } from "../db/card-repo.js";
import type { BoardRepo } from "../db/board-repo.js";

interface TelegramMessage {
  message_id: number;
  date: number;
  chat: { id: number; type: string };
  text?: string;
  voice?: { file_id: string; duration: number };
}

export class TelegramConnector implements Connector {
  name = "Telegram";
  icon = "send";
  private bot: TelegramBot | null = null;
  private boardRepo: BoardRepo | null = null;
  private cardRepo: CardRepo | null = null;

  configure(token: string, boardRepo: BoardRepo, cardRepo: CardRepo) {
    this.boardRepo = boardRepo;
    this.cardRepo = cardRepo;
    this.bot = new TelegramBot(token, { polling: true });

    this.bot.on("message", async (msg) => {
      await this.handleMessage(msg as unknown as TelegramMessage);
    });
  }

  transformMessage(msg: TelegramMessage): KanbanItem {
    const text = msg.text || "(voice message)";
    const title = text.length > 100 ? text.slice(0, 100) + "..." : text;

    return {
      source_id: `telegram:${msg.message_id}`,
      source_type: "telegram",
      title,
      body: text.length > 100 ? text : null,
      metadata: { messageId: msg.message_id, chatId: msg.chat.id },
    };
  }

  private async handleMessage(msg: TelegramMessage): Promise<void> {
    if (!this.boardRepo || !this.cardRepo) return;

    const item = this.transformMessage(msg);
    const board = this.boardRepo.getOrCreateToday();

    this.cardRepo.upsertFromConnector({
      board_id: board.id,
      source_id: item.source_id,
      source_type: item.source_type,
      title: item.title,
      body: item.body,
      metadata: item.metadata,
    });
  }

  async fetchItems(): Promise<KanbanItem[]> {
    return [];
  }

  async executeAction(_item: KanbanItem, _action: ActionPayload): Promise<ActionResult> {
    return { success: false, message: "Telegram connector is input-only" };
  }

  stop() {
    this.bot?.stopPolling();
  }
}
