import type { KanbanItem, ActionPayload, ActionResult } from "@daily-kanban/shared";

export interface Connector {
  name: string;
  icon: string;
  fetchItems(): Promise<KanbanItem[]>;
  executeAction(item: KanbanItem, action: ActionPayload): Promise<ActionResult>;
}
