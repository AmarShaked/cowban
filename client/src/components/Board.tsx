import { useState, useEffect } from "react";
import type { Card, ColumnName } from "@daily-kanban/shared";
import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import { KanbanColumn } from "./KanbanColumn";
import { CreateCardDialog } from "./CreateCardDialog";
import { CardDetailPanel } from "./CardDetailPanel";
import { useBoard } from "../hooks/useBoard";
import { useAiProcessing } from "../hooks/useAiProcessing";
import { Link } from "react-router-dom";
import { Settings as SettingsIcon, Trash2, Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { api } from "../lib/api";

const COLUMNS: ColumnName[] = ["inbox", "in_process", "review", "ai_do", "human_do", "done"];

export function Board() {
  const { board, cards, loading, error, moveCard, createCard, purgeBoard, cardsByColumn, updateCard } =
    useBoard();
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const { processingCardId, logs, todos, activeQuestion, startProcessing, startExecution, answerQuestion, loadHistoricalLogs } = useAiProcessing();
  const { theme, setTheme } = useTheme();
  const [repos, setRepos] = useState<{ id: string; name: string; path: string }[]>([]);
  const [defaultRepoId, setDefaultRepoId] = useState<string | null>(null);

  useEffect(() => {
    api.getRepos().then((data) => {
      setRepos(data.repos);
      setDefaultRepoId(data.default_repo_id);
    });
  }, []);

  const handlePurge = async () => {
    try {
      await purgeBoard();
      toast.success("Board cleared");
    } catch {
      toast.error("Failed to clear board");
    } finally {
      setPurgeOpen(false);
    }
  };

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const cardId = Number(result.draggableId);
    const newColumn = result.destination.droppableId as ColumnName;
    moveCard(cardId, newColumn);

    if (newColumn === "in_process") {
      const card = cards.find((c) => c.id === cardId);
      if (card) setSelectedCard(card);
      startProcessing(cardId, updateCard);
    }
  };

  const handleCardClick = (card: Card) => {
    setSelectedCard((prev) => (prev?.id === card.id ? null : card));
  };

  const handleRepoChange = async (cardId: number, repoId: string) => {
    const updated = await api.setCardRepo(cardId, repoId);
    updateCard(updated);
  };

  // Keep selectedCard in sync with cards state (e.g. after move/toggle)
  const currentSelectedCard = selectedCard
    ? cards.find((c) => c.id === selectedCard.id) ?? null
    : null;

  useEffect(() => {
    if (currentSelectedCard && processingCardId !== currentSelectedCard.id) {
      loadHistoricalLogs(currentSelectedCard.id);
    }
  }, [currentSelectedCard?.id, processingCardId, loadHistoricalLogs]);

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
          <Button variant="ghost" size="icon" onClick={() => setPurgeOpen(true)}>
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            <Sun className="h-4 w-4 hidden dark:block" />
            <Moon className="h-4 w-4 block dark:hidden" />
          </Button>
          <Link to="/settings">
            <Button variant="ghost" size="icon">
              <SettingsIcon className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </header>
      <Dialog open={purgeOpen} onOpenChange={setPurgeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear Board</DialogTitle>
            <DialogDescription>
              This will delete all cards from today's board. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPurgeOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handlePurge}>
              Clear All Cards
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex-1 min-h-0 relative overflow-hidden">
        <div className="h-full overflow-x-auto p-4">
          <DragDropContext onDragEnd={onDragEnd}>
            <div className="flex gap-4 h-full">
              {COLUMNS.map((col) => (
                <KanbanColumn
                  key={col}
                  column={col}
                  cards={cardsByColumn(col)}
                  selectedCardId={currentSelectedCard?.id}
                  processingCardId={processingCardId}
                  onCardClick={handleCardClick}
                />
              ))}
            </div>
          </DragDropContext>
        </div>

        {currentSelectedCard && (
          <CardDetailPanel
            card={currentSelectedCard}
            onClose={() => setSelectedCard(null)}
            processingLogs={processingCardId === currentSelectedCard.id ? logs : logs}
            todos={processingCardId === currentSelectedCard.id ? todos : todos}
            activeQuestion={processingCardId === currentSelectedCard.id ? activeQuestion : activeQuestion}
            isLiveProcessing={processingCardId === currentSelectedCard.id}
            onProcess={(customRequest) => startProcessing(currentSelectedCard.id, updateCard, customRequest)}
            onExecuteCode={() => startExecution(currentSelectedCard.id, updateCard)}
            onAnswerQuestion={(answer) => answerQuestion(currentSelectedCard.id, answer, updateCard)}
            repos={repos}
            defaultRepoId={defaultRepoId}
            onRepoChange={(repoId) => handleRepoChange(currentSelectedCard.id, repoId)}
          />
        )}
      </div>
    </div>
  );
}
