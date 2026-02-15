// client/src/hooks/useBoard.ts
import { useState, useEffect, useCallback } from "react";
import type { Board, Card, ColumnName } from "@daily-kanban/shared";
import { api } from "../lib/api";

export function useBoard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api.getBoard();
      setBoard(data.board);
      setCards(data.cards);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load board");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const moveCard = useCallback(async (cardId: number, column: ColumnName) => {
    const updated = await api.moveCard(cardId, column);
    setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }, []);

  const toggleAi = useCallback(async (cardId: number, value: boolean) => {
    const updated = await api.toggleAi(cardId, value);
    setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));

    if (value) {
      try {
        const evaluated = await api.evaluateCard(cardId);
        setCards((prev) => prev.map((c) => (c.id === evaluated.id ? evaluated : c)));
      } catch {
        const refreshed = await api.toggleAi(cardId, false);
        setCards((prev) => prev.map((c) => (c.id === refreshed.id ? refreshed : c)));
      }
    }
  }, []);

  const createCard = useCallback(async (title: string, body?: string) => {
    const card = await api.createCard(title, body);
    setCards((prev) => [...prev, card]);
  }, []);

  const cardsByColumn = (column: ColumnName) =>
    cards.filter((c) => c.column_name === column);

  return {
    board,
    cards,
    loading,
    error,
    refresh,
    moveCard,
    toggleAi,
    createCard,
    cardsByColumn,
  };
}
