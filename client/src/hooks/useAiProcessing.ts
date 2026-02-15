import { useState, useRef, useCallback } from "react";
import type { Card } from "@daily-kanban/shared";
import { api } from "../lib/api";

export interface ProcessingLog {
  step: string;
  message: string;
}

export function useAiProcessing() {
  const [processingCardId, setProcessingCardId] = useState<number | null>(null);
  const [logs, setLogs] = useState<ProcessingLog[]>([]);
  const abortRef = useRef<{ abort: () => void } | null>(null);

  const startProcessing = useCallback(
    (cardId: number, onCardUpdate: (card: Card) => void, customRequest?: string) => {
      // Abort any existing processing
      abortRef.current?.abort();

      setProcessingCardId(cardId);
      setLogs([]);

      const handle = api.processCardStream(cardId, (event) => {
        setLogs((prev) => [...prev, { step: event.step, message: event.message }]);
        if (event.step === "done" && event.card) {
          onCardUpdate(event.card);
          setProcessingCardId(null);
        }
      }, customRequest);

      abortRef.current = handle;
    },
    [],
  );

  const startExecution = useCallback(
    (cardId: number, onCardUpdate: (card: Card) => void) => {
      abortRef.current?.abort();

      setProcessingCardId(cardId);
      setLogs([]);

      const handle = api.executeCodeStream(cardId, (event) => {
        setLogs((prev) => [...prev, { step: event.step, message: event.message }]);
        if (event.step === "done" && event.card) {
          onCardUpdate(event.card);
          setProcessingCardId(null);
        }
      });

      abortRef.current = handle;
    },
    [],
  );

  return { processingCardId, logs, startProcessing, startExecution };
}
