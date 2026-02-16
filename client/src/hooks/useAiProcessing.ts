import { useState, useRef, useCallback, useEffect } from "react";
import type { Card, TodoItem, QuestionEvent, ExecutionLog } from "@daily-kanban/shared";
import { api } from "../lib/api";

export interface ProcessingLog {
  step: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp?: string;
}

export interface QueuedAction {
  id: string;
  type: "process" | "execute";
  customRequest?: string;
  addedAt: string;
}

export function useAiProcessing() {
  const [processingCardId, setProcessingCardId] = useState<number | null>(null);
  const [logs, setLogs] = useState<ProcessingLog[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [activeQuestion, setActiveQuestion] = useState<QuestionEvent | null>(null);
  const [actionQueue, setActionQueue] = useState<QueuedAction[]>([]);
  const abortRef = useRef<{ abort: () => void } | null>(null);
  const onCardUpdateRef = useRef<((card: Card) => void) | null>(null);
  const queueCardIdRef = useRef<number | null>(null);

  const handleEvent = useCallback(
    (event: { step: string; message: string; card?: Card; data?: Record<string, unknown> }, onCardUpdate: (card: Card) => void) => {
      setLogs((prev) => [...prev, {
        step: event.step,
        message: event.message,
        data: event.data,
        timestamp: new Date().toISOString(),
      }]);

      if (event.step === "todo" && event.data) {
        const todoData = event.data as unknown as TodoItem;
        setTodos((prev) => {
          const idx = prev.findIndex((t) => t.id === todoData.id);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = todoData;
            return updated;
          }
          return [...prev, todoData];
        });
      }

      if (event.step === "question" && event.data) {
        setActiveQuestion({
          questionId: event.data.questionId as number,
          question: event.message,
          header: event.data.header as string | undefined,
          options: event.data.options as QuestionEvent["options"],
          multiSelect: event.data.multiSelect as boolean | undefined,
        });
      }

      if (event.step === "done" && event.card) {
        onCardUpdate(event.card);
        setProcessingCardId(null);
        setActiveQuestion(null);
      }
    },
    [],
  );

  const startProcessing = useCallback(
    (cardId: number, onCardUpdate: (card: Card) => void, customRequest?: string) => {
      // If already processing a card, queue the action instead
      if (processingCardId !== null) {
        setActionQueue((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            type: "process",
            customRequest,
            addedAt: new Date().toISOString(),
          },
        ]);
        onCardUpdateRef.current = onCardUpdate;
        queueCardIdRef.current = cardId;
        return;
      }

      abortRef.current?.abort();
      setProcessingCardId(cardId);
      setLogs([]);
      setTodos([]);
      setActiveQuestion(null);
      onCardUpdateRef.current = onCardUpdate;
      queueCardIdRef.current = cardId;

      const handle = api.processCardStream(cardId, (event) => {
        handleEvent(event, onCardUpdate);
      }, customRequest);

      abortRef.current = handle;
    },
    [handleEvent, processingCardId],
  );

  const startExecution = useCallback(
    (cardId: number, onCardUpdate: (card: Card) => void) => {
      // If already processing, queue the execution
      if (processingCardId !== null) {
        setActionQueue((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            type: "execute",
            addedAt: new Date().toISOString(),
          },
        ]);
        onCardUpdateRef.current = onCardUpdate;
        queueCardIdRef.current = cardId;
        return;
      }

      abortRef.current?.abort();
      setProcessingCardId(cardId);
      setLogs([]);
      setTodos([]);
      setActiveQuestion(null);
      onCardUpdateRef.current = onCardUpdate;
      queueCardIdRef.current = cardId;

      const handle = api.executeCodeStream(cardId, (event) => {
        handleEvent(event, onCardUpdate);
      });

      abortRef.current = handle;
    },
    [handleEvent, processingCardId],
  );

  const answerQuestion = useCallback(
    (cardId: number, answer: string, onCardUpdate: (card: Card) => void) => {
      setActiveQuestion(null);
      setLogs((prev) => [...prev, { step: "answer", message: answer, timestamp: new Date().toISOString() }]);

      const handle = api.answerQuestion(cardId, answer, (event) => {
        handleEvent(event, onCardUpdate);
      });

      abortRef.current = handle;
    },
    [handleEvent],
  );

  const loadHistoricalLogs = useCallback(async (cardId: number) => {
    try {
      const { logs: historicalLogs } = await api.getExecutionLogs(cardId);
      const mapped: ProcessingLog[] = historicalLogs.map((l: ExecutionLog) => ({
        step: l.step,
        message: l.message,
        data: l.data || undefined,
        timestamp: l.created_at ? l.created_at + "Z" : undefined,
      }));
      setLogs(mapped);

      // Extract todos from historical logs
      const todoLogs = historicalLogs.filter((l: ExecutionLog) => l.step === "todo" && l.data);
      const todoItems: TodoItem[] = todoLogs.map((l: ExecutionLog) => l.data as unknown as TodoItem);
      setTodos(todoItems);

      // Check for unanswered question
      const questionLogs = historicalLogs.filter((l: ExecutionLog) => l.step === "question");
      const answerLogs = historicalLogs.filter((l: ExecutionLog) => l.step === "answer");
      if (questionLogs.length > answerLogs.length) {
        const lastQuestion = questionLogs[questionLogs.length - 1];
        if (lastQuestion.data) {
          setActiveQuestion({
            questionId: lastQuestion.id,
            question: lastQuestion.message,
            header: lastQuestion.data.header as string | undefined,
            options: lastQuestion.data.options as QuestionEvent["options"],
            multiSelect: lastQuestion.data.multiSelect as boolean | undefined,
          });
        }
      }
    } catch (err) {
      console.error("Failed to load historical logs:", err);
    }
  }, []);

  const removeFromQueue = useCallback((id: string) => {
    setActionQueue((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clearQueue = useCallback(() => {
    setActionQueue([]);
  }, []);

  // Auto-dequeue: when processing finishes and queue has items
  useEffect(() => {
    if (processingCardId === null && actionQueue.length > 0) {
      const cardId = queueCardIdRef.current;
      const onCardUpdate = onCardUpdateRef.current;
      if (!cardId || !onCardUpdate) return;

      const next = actionQueue[0];
      setActionQueue((prev) => prev.slice(1));

      // Small delay so the UI can show completion before starting next
      const timer = setTimeout(() => {
        setProcessingCardId(cardId);
        setLogs([]);
        setTodos([]);
        setActiveQuestion(null);

        if (next.type === "execute") {
          const handle = api.executeCodeStream(cardId, (event) => {
            handleEvent(event, onCardUpdate);
          });
          abortRef.current = handle;
        } else {
          const handle = api.processCardStream(cardId, (event) => {
            handleEvent(event, onCardUpdate);
          }, next.customRequest);
          abortRef.current = handle;
        }
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [processingCardId, actionQueue, handleEvent]);

  return {
    processingCardId,
    logs,
    todos,
    activeQuestion,
    actionQueue,
    startProcessing,
    startExecution,
    answerQuestion,
    loadHistoricalLogs,
    removeFromQueue,
    clearQueue,
  };
}
