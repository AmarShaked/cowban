import { useState, useRef, useCallback } from "react";
import type { Card, TodoItem, QuestionEvent } from "@daily-kanban/shared";
import { api } from "../lib/api";

export interface ProcessingLog {
  step: string;
  message: string;
  data?: Record<string, unknown>;
}

export function useAiProcessing() {
  const [processingCardId, setProcessingCardId] = useState<number | null>(null);
  const [logs, setLogs] = useState<ProcessingLog[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [activeQuestion, setActiveQuestion] = useState<QuestionEvent | null>(null);
  const abortRef = useRef<{ abort: () => void } | null>(null);

  const handleEvent = useCallback(
    (event: { step: string; message: string; card?: Card; data?: Record<string, unknown> }, onCardUpdate: (card: Card) => void) => {
      setLogs((prev) => [...prev, { step: event.step, message: event.message, data: event.data }]);

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
      abortRef.current?.abort();

      setProcessingCardId(cardId);
      setLogs([]);
      setTodos([]);
      setActiveQuestion(null);

      const handle = api.processCardStream(cardId, (event) => {
        handleEvent(event, onCardUpdate);
      }, customRequest);

      abortRef.current = handle;
    },
    [handleEvent],
  );

  const startExecution = useCallback(
    (cardId: number, onCardUpdate: (card: Card) => void) => {
      abortRef.current?.abort();

      setProcessingCardId(cardId);
      setLogs([]);
      setTodos([]);
      setActiveQuestion(null);

      const handle = api.executeCodeStream(cardId, (event) => {
        handleEvent(event, onCardUpdate);
      });

      abortRef.current = handle;
    },
    [handleEvent],
  );

  const answerQuestion = useCallback(
    (cardId: number, answer: string, onCardUpdate: (card: Card) => void) => {
      setActiveQuestion(null);
      setLogs((prev) => [...prev, { step: "answer", message: answer }]);

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
      const mapped: ProcessingLog[] = historicalLogs.map((l) => ({
        step: l.step,
        message: l.message,
        data: l.data || undefined,
      }));
      setLogs(mapped);

      // Extract todos from historical logs
      const todoLogs = historicalLogs.filter((l) => l.step === "todo" && l.data);
      const todoItems: TodoItem[] = todoLogs.map((l) => l.data as unknown as TodoItem);
      setTodos(todoItems);

      // Check for unanswered question
      const questionLogs = historicalLogs.filter((l) => l.step === "question");
      const answerLogs = historicalLogs.filter((l) => l.step === "answer");
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

  return {
    processingCardId,
    logs,
    todos,
    activeQuestion,
    startProcessing,
    startExecution,
    answerQuestion,
    loadHistoricalLogs,
  };
}
