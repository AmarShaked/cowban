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

  evaluateCard: (cardId: number) =>
    fetchJson<Card>(`/ai/evaluate/${cardId}`, { method: "POST" }),

  executeCard: (cardId: number) =>
    fetchJson<Card>(`/ai/execute/${cardId}`, { method: "POST" }),

  getRepos: () =>
    fetchJson<{ repos: { id: string; name: string; path: string }[]; default_repo_id: string | null }>("/repos"),

  addRepo: (name: string, path: string) =>
    fetchJson<{ id: string; name: string; path: string }>("/repos", {
      method: "POST",
      body: JSON.stringify({ name, path }),
    }),

  deleteRepo: (id: string) =>
    fetchJson<{ success: boolean }>(`/repos/${id}`, { method: "DELETE" }),

  setDefaultRepo: (repo_id: string | null) =>
    fetchJson<{ success: boolean }>("/repos/default", {
      method: "PATCH",
      body: JSON.stringify({ repo_id }),
    }),

  setCardRepo: (cardId: number, repo_id: string) =>
    fetchJson<Card>(`/cards/${cardId}/repo`, {
      method: "PATCH",
      body: JSON.stringify({ repo_id }),
    }),

  executeCodeStream: (
    cardId: number,
    onEvent: (event: { step: string; message: string; card?: Card }) => void,
  ): { abort: () => void } => {
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch(`${BASE}/ai/execute-code/${cardId}`, {
          method: "POST",
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          onEvent({ step: "error", message: `API error: ${res.status}` });
          onEvent({ step: "done", message: "Execution failed" });
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const event = JSON.parse(line.slice(6));
                onEvent(event);
              } catch {
                // skip malformed
              }
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          onEvent({ step: "error", message: "Connection failed" });
          onEvent({ step: "done", message: "Execution failed" });
        }
      }
    })();

    return { abort: () => controller.abort() };
  },

  purgeBoard: () =>
    fetchJson<{ success: boolean; deleted: number }>("/board/today", {
      method: "DELETE",
    }),

  processCardStream: (
    cardId: number,
    onEvent: (event: { step: string; message: string; card?: Card }) => void,
    customRequest?: string,
  ): { abort: () => void } => {
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch(`${BASE}/ai/process-stream/${cardId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customRequest }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          onEvent({ step: "error", message: `API error: ${res.status}` });
          onEvent({ step: "done", message: "Processing failed" });
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const event = JSON.parse(line.slice(6));
                onEvent(event);
              } catch {
                // Skip malformed SSE events
              }
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          onEvent({ step: "error", message: "Connection failed" });
          onEvent({ step: "done", message: "Processing failed" });
        }
      }
    })();

    return { abort: () => controller.abort() };
  },

  getExecutionLogs: (cardId: number) =>
    fetchJson<{ logs: import("@daily-kanban/shared").ExecutionLog[] }>(`/ai/logs/${cardId}`),

  answerQuestion: (
    cardId: number,
    answer: string,
    onEvent: (event: { step: string; message: string; card?: Card; data?: Record<string, unknown> }) => void,
  ): { abort: () => void } => {
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch(`${BASE}/ai/answer/${cardId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answer }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          onEvent({ step: "error", message: `API error: ${res.status}` });
          onEvent({ step: "done", message: "Resume failed" });
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const event = JSON.parse(line.slice(6));
                onEvent(event);
              } catch {
                // Skip malformed
              }
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          onEvent({ step: "error", message: "Connection failed" });
          onEvent({ step: "done", message: "Resume failed" });
        }
      }
    })();

    return { abort: () => controller.abort() };
  },
};
