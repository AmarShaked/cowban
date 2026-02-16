import type { QueuedAction } from "../hooks/useAiProcessing";
import { Button } from "@/components/ui/button";
import { X, ListOrdered, Trash2 } from "lucide-react";

interface QueuedActionsProps {
  queue: QueuedAction[];
  onRemove: (id: string) => void;
  onClear: () => void;
}

export function QueuedActions({ queue, onRemove, onClear }: QueuedActionsProps) {
  if (queue.length === 0) return null;

  return (
    <div className="rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium text-blue-700 dark:text-blue-400">
          <ListOrdered className="h-3.5 w-3.5" />
          Queued Actions ({queue.length})
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-3 w-3 mr-0.5" />
          Clear
        </Button>
      </div>
      <div className="space-y-1">
        {queue.map((action, i) => (
          <div
            key={action.id}
            className="flex items-center gap-2 text-xs rounded-md bg-background/60 px-2 py-1.5"
          >
            <span className="text-muted-foreground font-mono w-4 text-center shrink-0">
              {i + 1}
            </span>
            <span className="flex-1 truncate">
              {action.type === "execute"
                ? "Execute Code Changes"
                : action.customRequest || "AI Evaluation"}
            </span>
            <button
              onClick={() => onRemove(action.id)}
              className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
