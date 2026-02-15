import { useState, useRef, useCallback, useEffect } from "react";
import type { Card } from "@daily-kanban/shared";
import Markdown from "react-markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X, Mail, Calendar, GitMerge, Send, ListTodo, PenLine, ExternalLink, Loader2, CheckCircle2, AlertTriangle, Sparkles } from "lucide-react";

const sourceIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  gmail: Mail,
  calendar: Calendar,
  linear: ListTodo,
  gitlab: GitMerge,
  telegram: Send,
  manual: PenLine,
};

const sourceLabels: Record<string, string> = {
  gmail: "Gmail",
  calendar: "Calendar",
  linear: "Linear",
  gitlab: "GitLab",
  telegram: "Telegram",
  manual: "Manual",
};

export interface ProcessingLog {
  step: string;
  message: string;
}

interface CardDetailPanelProps {
  card: Card;
  onClose: () => void;
  processingLogs?: ProcessingLog[];
  onProcess?: (customRequest?: string) => void;
  onExecuteCode?: () => void;
  repos?: { id: string; name: string; path: string }[];
  defaultRepoId?: string | null;
  onRepoChange?: (repoId: string) => void;
}

export function CardDetailPanel({ card, onClose, processingLogs, onProcess, onExecuteCode, repos, defaultRepoId, onRepoChange }: CardDetailPanelProps) {
  const Icon = sourceIcons[card.source_type] || PenLine;
  const externalUrl = card.metadata?.url as string | undefined;

  const [customRequest, setCustomRequest] = useState("");
  const [width, setWidth] = useState(400);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [processingLogs?.length]);

  const onResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;

    const onMove = (ev: PointerEvent) => {
      if (!dragging.current) return;
      const delta = startX.current - ev.clientX;
      const newWidth = Math.min(Math.max(startWidth.current + delta, 300), 800);
      setWidth(newWidth);
    };

    const onUp = () => {
      dragging.current = false;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }, [width]);

  const isProcessing = processingLogs && processingLogs.length > 0 && !processingLogs.some(l => l.step === "done");

  return (
    <div
      className="absolute right-0 top-0 bottom-0 flex bg-background border-l shadow-xl z-10"
      style={{ width }}
    >
      {/* Resize handle */}
      <div
        className="w-1.5 cursor-col-resize hover:bg-accent/50 active:bg-accent shrink-0"
        onPointerDown={onResizePointerDown}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2 min-w-0">
            <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-xs text-muted-foreground">{sourceLabels[card.source_type] || card.source_type}</span>
            {card.confidence !== null && (
              <Badge variant={card.confidence >= 80 ? "default" : "secondary"}>
                {card.confidence}%
              </Badge>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">{card.title}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-muted-foreground capitalize">{card.column_name.replace("_", " ")}</span>
              <span className="text-xs text-muted-foreground">
                {new Date(card.created_at).toLocaleString()}
              </span>
            </div>
          </div>

          {repos && repos.length > 0 && onRepoChange && (
            <div>
              <h3 className="text-sm font-medium mb-1">Repository</h3>
              <select
                value={(card.metadata?.repo_id as string) || defaultRepoId || ""}
                onChange={(e) => onRepoChange(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">No repo</option>
                {repos.map((r) => (
                  <option key={r.id} value={r.id}>{r.name} — {r.path}</option>
                ))}
              </select>
            </div>
          )}

          {card.body && (
            <div>
              <h3 className="text-sm font-medium mb-1">
                {card.metadata?.repo_id && card.column_name === "review" ? "Implementation Plan" : "Description"}
              </h3>
              {card.metadata?.repo_id && card.column_name === "review" ? (
                <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
                  <Markdown>{card.body}</Markdown>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{card.body}</p>
              )}
            </div>
          )}

          {onProcess && (
            <div>
              <h3 className="text-sm font-medium mb-1">AI Request</h3>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  onProcess(customRequest || undefined);
                  setCustomRequest("");
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  value={customRequest}
                  onChange={(e) => setCustomRequest(e.target.value)}
                  placeholder="e.g. delete this email, close the issue..."
                  disabled={isProcessing}
                  className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                />
                <Button type="submit" size="sm" disabled={isProcessing}>
                  <Sparkles className="h-3 w-3 mr-1" />
                  Run
                </Button>
              </form>
            </div>
          )}

          {card.proposed_action && (
            <div>
              <h3 className="text-sm font-medium mb-1">AI Proposed Action</h3>
              <p className="text-sm text-blue-600 dark:text-blue-400">{card.proposed_action}</p>
            </div>
          )}

          {card.column_name === "review" && card.metadata?.repo_id && onExecuteCode && !isProcessing && (
            <Button onClick={onExecuteCode} className="w-full">
              Execute Code Changes
            </Button>
          )}

          {card.execution_result && (
            <div>
              <h3 className="text-sm font-medium mb-1">Execution Result</h3>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{card.execution_result}</p>
            </div>
          )}

          {/* AI Processing Logs */}
          {processingLogs && processingLogs.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
                AI Processing
                {isProcessing && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
              </h3>
              <div className="space-y-1.5 text-xs">
                {processingLogs.map((log, i) => (
                  <LogEntry key={i} log={log} />
                ))}
                <div ref={logsEndRef} />
              </div>
            </div>
          )}

          {card.metadata && Object.keys(card.metadata).length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-1">Details</h3>
              <dl className="text-sm space-y-1">
                {Object.entries(card.metadata).map(([key, value]) => {
                  if (key === "url") return null;
                  return (
                    <div key={key} className="flex gap-2">
                      <dt className="text-muted-foreground capitalize">{key.replace(/_/g, " ")}:</dt>
                      <dd className="break-all">{String(value)}</dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          )}

          {externalUrl && (
            <a
              href={externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              Open in {sourceLabels[card.source_type] || "source"}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function LogEntry({ log }: { log: ProcessingLog }) {
  switch (log.step) {
    case "start":
    case "evaluating":
    case "executing":
      return (
        <div className="flex items-start gap-2 text-amber-600 dark:text-amber-400">
          <Loader2 className="h-3 w-3 mt-0.5 animate-spin shrink-0" />
          <span>{log.message}</span>
        </div>
      );
    case "ai_output":
      return (
        <div className="pl-5 font-mono text-muted-foreground whitespace-pre-wrap break-all">
          {log.message}
        </div>
      );
    case "done":
    case "executed":
      return (
        <div className="flex items-start gap-2 text-green-600 dark:text-green-400">
          <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0" />
          <span>{log.message}</span>
        </div>
      );
    case "low_confidence":
    case "error":
      return (
        <div className="flex items-start gap-2 text-red-600 dark:text-red-400">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          <span>{log.message}</span>
        </div>
      );
    default:
      return (
        <div className="flex items-start gap-2 text-muted-foreground">
          <span className="pl-5">{log.message}</span>
        </div>
      );
  }
}
