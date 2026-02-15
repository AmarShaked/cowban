import type { Card } from "@daily-kanban/shared";
import { Card as ShadcnCard, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
  onToggleAi: (cardId: number, value: boolean) => void;
}

export function KanbanCard({ card, index, onToggleAi }: KanbanCardProps) {
  const Icon = sourceIcons[card.source_type] || PenLine;

  return (
    <Draggable draggableId={String(card.id)} index={index}>
      {(provided) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className="mb-2"
        >
          <ShadcnCard className="shadow-sm">
            <CardHeader className="p-3 pb-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
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
                {card.column_name === "inbox" && (
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">AI</span>
                    <Switch
                      checked={card.ai_toggle}
                      onCheckedChange={(checked) => onToggleAi(card.id, checked)}
                      className="scale-75"
                    />
                  </div>
                )}
              </div>
            </CardContent>
          </ShadcnCard>
        </div>
      )}
    </Draggable>
  );
}
