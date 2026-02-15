// server/src/scheduler.ts
import type { ConnectorRegistry } from "./connectors/registry.js";
import type { BoardRepo } from "./db/board-repo.js";
import type { CardRepo } from "./db/card-repo.js";

export class Scheduler {
  private intervals: NodeJS.Timeout[] = [];

  constructor(
    private registry: ConnectorRegistry,
    private boardRepo: BoardRepo,
    private cardRepo: CardRepo
  ) {}

  async pollAll(): Promise<void> {
    const board = this.boardRepo.getOrCreateToday();
    const connectors = this.registry.getAllEntries();

    for (const [name, connector] of connectors) {
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
