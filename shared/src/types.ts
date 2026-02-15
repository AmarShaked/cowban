// shared/src/types.ts

export type ColumnName = "inbox" | "in_process" | "review" | "ai_do" | "human_do" | "done";

export type SourceType = "gmail" | "calendar" | "linear" | "gitlab" | "telegram" | "manual";

export interface Board {
  id: number;
  date: string; // YYYY-MM-DD
  created_at: string;
}

export interface Card {
  id: number;
  board_id: number;
  source_id: string | null;
  source_type: SourceType;
  column_name: ColumnName;
  title: string;
  body: string | null;
  metadata: Record<string, unknown> | null;
  ai_toggle: boolean;
  confidence: number | null;
  proposed_action: string | null;
  action_payload: Record<string, unknown> | null;
  execution_result: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConnectorConfig {
  id: number;
  type: SourceType;
  credentials: Record<string, unknown> | null;
  settings: Record<string, unknown> | null;
  enabled: boolean;
}

export interface KanbanItem {
  source_id: string;
  source_type: SourceType;
  title: string;
  body: string | null;
  metadata: Record<string, unknown>;
}

export interface ActionPayload {
  type: string;
  [key: string]: unknown;
}

export interface ActionResult {
  success: boolean;
  message: string;
}

export interface AiEvaluation {
  canAutomate: boolean;
  confidence: number;
  proposedAction: string;
  actionPayload: ActionPayload | null;
}

// API request/response types
export interface CreateCardRequest {
  title: string;
  body?: string;
}

export interface MoveCardRequest {
  column_name: ColumnName;
}

export interface ToggleAiRequest {
  ai_toggle: boolean;
}
