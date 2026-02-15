// server/src/connectors/__tests__/registry.test.ts
import { describe, it, expect } from "vitest";
import { ConnectorRegistry } from "../registry.js";
import type { Connector } from "../types.js";

const mockConnector: Connector = {
  name: "mock",
  icon: "mock-icon",
  async fetchItems() {
    return [
      {
        source_id: "mock:1",
        source_type: "gmail",
        title: "Mock item",
        body: "Body",
        metadata: {},
      },
    ];
  },
  async executeAction() {
    return { success: true, message: "done" };
  },
};

describe("ConnectorRegistry", () => {
  it("registers and retrieves connectors", () => {
    const registry = new ConnectorRegistry();
    registry.register("mock", mockConnector);
    expect(registry.get("mock")).toBe(mockConnector);
    expect(registry.getAll()).toHaveLength(1);
  });

  it("returns undefined for unknown connector", () => {
    const registry = new ConnectorRegistry();
    expect(registry.get("unknown")).toBeUndefined();
  });
});
