import { useRef } from "react";
import type { Card } from "@daily-kanban/shared";
import { Card as ShadcnCard, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Draggable } from "@hello-pangea/dnd";
import { Mail, Calendar, GitMerge, Send, ListTodo, PenLine } from "lucide-react";

const sourceIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  gmail: Mail,
  calendar: Calendar,
  linear: ListTodo,
  gitlab: GitMerge,
  telegram: Send,
  manual: PenLine,
};

interface KanbanCardProps {
  card: Card;
  index: number;
  selected?: boolean;
  isProcessing?: boolean;
  onClick?: (card: Card) => void;
}

export function KanbanCard({ card, index, selected, isProcessing, onClick }: KanbanCardProps) {
  const Icon = sourceIcons[card.source_type] || PenLine;
  const pointerStart = useRef<{ x: number; y: number } | null>(null);

  return (
    <Draggable draggableId={String(card.id)} index={index}>
      {(provided) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className="mb-2"
          onPointerDown={(e) => {
            pointerStart.current = { x: e.clientX, y: e.clientY };
          }}
          onPointerUp={(e) => {
            if (!pointerStart.current) return;
            const dx = e.clientX - pointerStart.current.x;
            const dy = e.clientY - pointerStart.current.y;
            if (Math.abs(dx) < 5 && Math.abs(dy) < 5) {
              onClick?.(card);
            }
            pointerStart.current = null;
          }}
        >
          <ShadcnCard className={`relative overflow-hidden shadow-sm cursor-pointer transition-colors hover:bg-accent/50 ${selected ? "ring-2 ring-ring" : ""}`}>
            {isProcessing && (
              <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500 animate-shimmer" />
            )}
            <CardHeader className="p-3 pb-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {isProcessing ? (
                    <div className="relative h-4 w-4 shrink-0">
                      <div className="absolute inset-0 rounded-full border-2 border-cyan-500/30" />
                      <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-cyan-500 animate-spin" />
                    </div>
                  ) : (
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  )}
                  <CardTitle className="text-sm font-medium leading-tight">
                    {card.title}
                  </CardTitle>
                </div>
                {card.confidence !== null && (
                  <Badge variant={card.confidence >= 80 ? "default" : "secondary"}>
                    {card.confidence}%
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-3 pt-1">
              {card.body && (
                <CardDescription className="text-xs line-clamp-2 mb-2">
                  {card.body}
                </CardDescription>
              )}
              {card.proposed_action && (
                <p className="text-xs text-blue-600 dark:text-blue-400 mb-2">
                  AI: {card.proposed_action}
                </p>
              )}
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {new Date(card.created_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                {isProcessing && (
                  <span className="text-xs text-cyan-600 dark:text-cyan-400 animate-pulse">
                    Processing...
                  </span>
                )}
              </div>
            </CardContent>
          </ShadcnCard>
        </div>
      )}
    </Draggable>
  );
}
