import type { ColumnName } from "@daily-kanban/shared";
import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import { KanbanColumn } from "./KanbanColumn";
import { CreateCardDialog } from "./CreateCardDialog";
import { useBoard } from "../hooks/useBoard";
import { Link } from "react-router-dom";
import { Settings as SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

const COLUMNS: ColumnName[] = ["inbox", "review", "ai_do", "human_do", "done"];

export function Board() {
  const { board, loading, error, moveCard, toggleAi, createCard, cardsByColumn } =
    useBoard();

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const cardId = Number(result.draggableId);
    const newColumn = result.destination.droppableId as ColumnName;
    moveCard(cardId, newColumn);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-muted-foreground">
        Loading board...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen text-destructive">
        {error}
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="flex items-center justify-between p-4 border-b">
        <div>
          <h1 className="text-lg font-bold">Daily Kanban</h1>
          <p className="text-xs text-muted-foreground">{board?.date}</p>
        </div>
        <div className="flex gap-2">
          <CreateCardDialog onCreateCard={createCard} />
          <Link to="/settings">
            <Button variant="ghost" size="icon">
              <SettingsIcon className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </header>
      <div className="flex-1 overflow-x-auto p-4">
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex gap-4 h-full">
            {COLUMNS.map((col) => (
              <KanbanColumn
                key={col}
                column={col}
                cards={cardsByColumn(col)}
                onToggleAi={toggleAi}
              />
            ))}
          </div>
        </DragDropContext>
      </div>
    </div>
  );
}
