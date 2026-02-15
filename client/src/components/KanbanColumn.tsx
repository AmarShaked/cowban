import type { Card, ColumnName } from "@daily-kanban/shared";
import { Droppable } from "@hello-pangea/dnd";
import { KanbanCard } from "./KanbanCard";

const columnLabels: Record<ColumnName, string> = {
  inbox: "Inbox",
  in_process: "In Process",
  review: "Review",
  ai_do: "AI Do",
  human_do: "Human Do",
  done: "Done",
};

const columnColors: Record<ColumnName, string> = {
  inbox: "border-t-blue-500",
  in_process: "border-t-cyan-500",
  review: "border-t-yellow-500",
  ai_do: "border-t-purple-500",
  human_do: "border-t-orange-500",
  done: "border-t-green-500",
};

interface KanbanColumnProps {
  column: ColumnName;
  cards: Card[];
  selectedCardId?: number | null;
  processingCardId?: number | null;
  onCardClick?: (card: Card) => void;
}

export function KanbanColumn({ column, cards, selectedCardId, processingCardId, onCardClick }: KanbanColumnProps) {
  return (
    <div
      className={`flex flex-col w-72 min-w-[18rem] min-h-0 bg-muted/50 rounded-lg border-t-4 ${columnColors[column]}`}
    >
      <div className="flex items-center justify-between p-3 pb-2">
        <h2 className="text-sm font-semibold">{columnLabels[column]}</h2>
        <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
          {cards.length}
        </span>
      </div>
      <Droppable droppableId={column}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`flex-1 overflow-y-auto p-2 min-h-[200px] transition-colors ${
              snapshot.isDraggingOver ? "bg-muted" : ""
            }`}
          >
            {cards.map((card, index) => (
              <KanbanCard
                key={card.id}
                card={card}
                index={index}
                selected={selectedCardId === card.id}
                isProcessing={processingCardId === card.id}
                onClick={onCardClick}
              />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
}
