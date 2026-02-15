// server/src/__tests__/scheduler.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../db/migrate.js";
import { Scheduler } from "../scheduler.js";
import { ConnectorRegistry } from "../connectors/registry.js";
import { BoardRepo } from "../db/board-repo.js";
import { CardRepo } from "../db/card-repo.js";
import type { Connector } from "../connectors/types.js";

describe("Scheduler", () => {
  let db: Database.Database;
  let registry: ConnectorRegistry;
  let boardRepo: BoardRepo;
  let cardRepo: CardRepo;

  beforeEach(() => {
    db = new Database(":memory:");
    migrate(db);
    registry = new ConnectorRegistry();
    boardRepo = new BoardRepo(db);
    cardRepo = new CardRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  it("polls connectors and inserts new items", async () => {
    const mockConnector: Connector = {
      name: "mock",
      icon: "mock",
      async fetchItems() {
        return [
          { source_id: "mock:1", source_type: "gmail", title: "Item 1", body: null, metadata: {} },
          { source_id: "mock:2", source_type: "gmail", title: "Item 2", body: null, metadata: {} },
        ];
      },
      async executeAction() {
        return { success: true, message: "ok" };
      },
    };

    registry.register("mock", mockConnector);

    // Enable the mock connector in DB
    db.prepare("INSERT INTO connector_configs (type, credentials, enabled) VALUES (?, ?, ?)").run("mock", '{}', 1);

    const scheduler = new Scheduler(registry, boardRepo, cardRepo, db);
    await scheduler.pollAll();

    const board = boardRepo.getOrCreateToday();
    const cards = cardRepo.listByBoard(board.id);
    expect(cards).toHaveLength(2);
    expect(cards[0].title).toBe("Item 1");
  });

  it("skips disabled connectors", async () => {
    const mockConnector: Connector = {
      name: "mock",
      icon: "mock",
      async fetchItems() {
        return [
          { source_id: "mock:1", source_type: "gmail", title: "Item 1", body: null, metadata: {} },
        ];
      },
      async executeAction() {
        return { success: true, message: "ok" };
      },
    };

    registry.register("mock", mockConnector);

    // Connector is disabled in DB
    db.prepare("INSERT INTO connector_configs (type, credentials, enabled) VALUES (?, ?, ?)").run("mock", '{}', 0);

    const scheduler = new Scheduler(registry, boardRepo, cardRepo, db);
    await scheduler.pollAll();

    const board = boardRepo.getOrCreateToday();
    const cards = cardRepo.listByBoard(board.id);
    expect(cards).toHaveLength(0);
  });

  it("skips connectors with no config row", async () => {
    const mockConnector: Connector = {
      name: "mock",
      icon: "mock",
      async fetchItems() {
        return [
          { source_id: "mock:1", source_type: "gmail", title: "Item 1", body: null, metadata: {} },
        ];
      },
      async executeAction() {
        return { success: true, message: "ok" };
      },
    };

    registry.register("mock", mockConnector);

    // No DB row for "mock" - should be treated as disabled
    const scheduler = new Scheduler(registry, boardRepo, cardRepo, db);
    await scheduler.pollAll();

    const board = boardRepo.getOrCreateToday();
    const cards = cardRepo.listByBoard(board.id);
    expect(cards).toHaveLength(0);
  });

  it("skips duplicate items on second poll", async () => {
    const mockConnector: Connector = {
      name: "mock",
      icon: "mock",
      async fetchItems() {
        return [
          { source_id: "mock:1", source_type: "gmail", title: "Item 1", body: null, metadata: {} },
        ];
      },
      async executeAction() {
        return { success: true, message: "ok" };
      },
    };

    registry.register("mock", mockConnector);

    // Enable the mock connector in DB
    db.prepare("INSERT INTO connector_configs (type, credentials, enabled) VALUES (?, ?, ?)").run("mock", '{}', 1);

    const scheduler = new Scheduler(registry, boardRepo, cardRepo, db);
    await scheduler.pollAll();
    await scheduler.pollAll();

    const board = boardRepo.getOrCreateToday();
    const cards = cardRepo.listByBoard(board.id);
    expect(cards).toHaveLength(1);
  });
});
