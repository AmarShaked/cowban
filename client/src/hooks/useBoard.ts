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
    const interval = setInterval(refresh, 30_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const moveCard = useCallback(async (cardId: number, column: ColumnName, position: number) => {
    // Optimistic update
    setCards((prev) =>
      prev.map((c) => (c.id === cardId ? { ...c, column_name: column, position } : c))
    );

    const updated = await api.moveCard(cardId, column, position);
    setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));

    if (column === "ai_do") {
      try {
        const executed = await api.executeCard(cardId);
        setCards((prev) => prev.map((c) => (c.id === executed.id ? executed : c)));
      } catch {
        await refresh();
      }
    }
  }, [refresh]);

  const createCard = useCallback(async (title: string, body?: string) => {
    const card = await api.createCard(title, body);
    setCards((prev) => [...prev, card]);
  }, []);

  const purgeBoard = useCallback(async () => {
    await api.purgeBoard();
    setCards([]);
  }, []);

  const updateCard = useCallback((card: Card) => {
    setCards((prev) => prev.map((c) => (c.id === card.id ? card : c)));
  }, []);

  const cardsByColumn = (column: ColumnName) =>
    cards.filter((c) => c.column_name === column).sort((a, b) => a.position - b.position);

  return {
    board,
    cards,
    loading,
    error,
    refresh,
    moveCard,
    createCard,
    purgeBoard,
    cardsByColumn,
    updateCard,
  };
}
