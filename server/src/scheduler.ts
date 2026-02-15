// server/src/scheduler.ts
import type Database from "better-sqlite3";
import type { ConnectorRegistry } from "./connectors/registry.js";
import type { BoardRepo } from "./db/board-repo.js";
import type { CardRepo } from "./db/card-repo.js";

export class Scheduler {
  private intervals: NodeJS.Timeout[] = [];

  constructor(
    private registry: ConnectorRegistry,
    private boardRepo: BoardRepo,
    private cardRepo: CardRepo,
    private db: Database.Database,
  ) {}

  private isConnectorEnabled(type: string): boolean {
    const config = this.db.prepare(
      "SELECT enabled FROM connector_configs WHERE type = ?"
    ).get(type) as { enabled: number } | undefined;

    // If no config row exists, treat as disabled
    return config ? Boolean(config.enabled) : false;
  }

  async pollAll(): Promise<void> {
    const board = this.boardRepo.getOrCreateToday();
    const connectors = this.registry.getAllEntries();

    for (const [name, connector] of connectors) {
      if (!this.isConnectorEnabled(name)) {
        continue;
      }

      try {
        const items = await connector.fetchItems();
        for (const item of items) {
          this.cardRepo.upsertFromConnector({
            board_id: board.id,
            source_id: item.source_id,
            source_type: item.source_type,
            title: item.title,
            body: item.body,
            metadata: item.metadata,
          });
        }
      } catch (err) {
        console.error(`Connector ${name} poll failed:`, err);
      }
    }
  }

  start(intervalMs: number = 5 * 60 * 1000): void {
    this.pollAll();
    const interval = setInterval(() => {
      this.pollAll();
    }, intervalMs);
    this.intervals.push(interval);
  }

  stop(): void {
    for (const interval of this.intervals) {
      clearInterval(interval);
    }
    this.intervals = [];
  }
}
