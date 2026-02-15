// client/src/lib/api.ts
import type { Board, Card, ColumnName } from "@daily-kanban/shared";

const BASE = "/api";

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export const api = {
  getBoard: () => fetchJson<{ board: Board; cards: Card[] }>("/board/today"),

  createCard: (title: string, body?: string) =>
    fetchJson<Card>("/cards", {
      method: "POST",
      body: JSON.stringify({ title, body }),
    }),

  moveCard: (id: number, column_name: ColumnName) =>
    fetchJson<Card>(`/cards/${id}/move`, {
      method: "PATCH",
      body: JSON.stringify({ column_name }),
    }),

  toggleAi: (id: number, ai_toggle: boolean) =>
    fetchJson<Card>(`/cards/${id}/ai-toggle`, {
      method: "PATCH",
      body: JSON.stringify({ ai_toggle }),
    }),
};
