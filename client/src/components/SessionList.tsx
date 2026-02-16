import type { ExecutionSession } from "@daily-kanban/shared";
import { Badge } from "@/components/ui/badge";
import { Play, FileCode, MessageCircle } from "lucide-react";

const typeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  execution: Play,
  planning: FileCode,
  answer: MessageCircle,
};

const statusColors: Record<string, "default" | "secondary" | "destructive"> = {
  running: "default",
  completed: "secondary",
  failed: "destructive",
  paused: "destructive",
};

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr + "Z");
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

interface SessionListProps {
  sessions: ExecutionSession[];
  selectedSessionId: number | null;
  onSelectSession: (sessionId: number) => void;
}

export function SessionList({ sessions, selectedSessionId, onSelectSession }: SessionListProps) {
  if (sessions.length === 0) {
    return <p className="text-xs text-muted-foreground py-2">No execution history</p>;
  }

  return (
    <div className="space-y-1">
      {sessions.map((session) => {
        const Icon = typeIcons[session.type] || Play;
        const isSelected = selectedSessionId === session.id;
        return (
          <button
            key={session.id}
            onClick={() => onSelectSession(session.id)}
            className={`w-full text-left rounded-md border px-2.5 py-2 text-xs transition-colors ${
              isSelected
                ? "border-primary bg-primary/5"
                : "border-transparent hover:bg-accent hover:text-accent-foreground"
            }`}
          >
            <div className="flex items-center gap-2">
              <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate font-medium">
                {session.summary || session.type}
              </span>
              <Badge variant={statusColors[session.status] || "secondary"} className="text-[10px] px-1.5 py-0">
                {session.status}
              </Badge>
            </div>
            <div className="mt-0.5 pl-5 text-muted-foreground">
              {formatRelativeTime(session.started_at)}
            </div>
          </button>
        );
      })}
    </div>
  );
}
