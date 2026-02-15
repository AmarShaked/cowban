import type { Connector } from "./types.js";

export class ConnectorRegistry {
  private connectors = new Map<string, Connector>();

  register(name: string, connector: Connector): void {
    this.connectors.set(name, connector);
  }

  get(name: string): Connector | undefined {
    return this.connectors.get(name);
  }

  getAll(): Connector[] {
    return Array.from(this.connectors.values());
  }

  getAllEntries(): [string, Connector][] {
    return Array.from(this.connectors.entries());
  }
}
