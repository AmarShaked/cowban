import { useState, useEffect, useRef, useCallback } from "react";
import type { ExecutionSession, ExecutionLog } from "@daily-kanban/shared";
import type { ProcessingLog } from "../hooks/useAiProcessing";
import { SessionList } from "./SessionList";
import { Badge } from "@/components/ui/badge";
import { api } from "../lib/api";
import {
  Loader2, CheckCircle2, AlertTriangle,
  MessageCircleQuestion, Send, Wrench, Terminal, Search, ArrowDown,
  History, Radio,
} from "lucide-react";

function formatTimestamp(ts?: string): string {
  if (!ts) return "";
  const date = new Date(ts);
  if (isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function LogEntry({ log }: { log: ProcessingLog }) {
  const ts = formatTimestamp(log.timestamp);
  const timestamp = ts ? (
    <span className="text-[10px] text-muted-foreground/60 shrink-0 tabular-nums">{ts}</span>
  ) : null;

  switch (log.step) {
    case "start":
    case "evaluating":
    case "executing":
      return (
        <div className="flex items-start gap-2 text-amber-600 dark:text-amber-400">
          <Loader2 className="h-3 w-3 mt-0.5 animate-spin shrink-0" />
          <span className="flex-1">{log.message}</span>
          {timestamp}
        </div>
      );
    case "ai_output":
      return (
        <div className="flex items-start gap-1">
          <div className="pl-5 font-mono text-muted-foreground whitespace-pre-wrap break-all flex-1">
            {log.message}
          </div>
          {timestamp}
        </div>
      );
    case "tool_start":
      return (
        <div className="flex items-start gap-2 text-purple-600 dark:text-purple-400">
          <Wrench className="h-3 w-3 mt-0.5 shrink-0" />
          <span className="font-medium flex-1">{log.message}</span>
          {timestamp}
        </div>
      );
    case "tool_complete":
      return (
        <div className="flex items-start gap-2 text-purple-600 dark:text-purple-400">
          <Terminal className="h-3 w-3 mt-0.5 shrink-0" />
          <span className="font-mono text-xs flex-1">{log.message}</span>
          {timestamp}
        </div>
      );
    case "tool_result":
      return (
        <div className="flex items-start gap-1">
          <div className="pl-5 font-mono text-xs text-muted-foreground whitespace-pre-wrap break-all bg-muted/50 rounded p-1.5 max-h-48 overflow-y-auto flex-1">
            {log.message}
          </div>
          {timestamp}
        </div>
      );
    case "question":
      return (
        <div className="flex items-start gap-2 text-amber-600 dark:text-amber-400">
          <MessageCircleQuestion className="h-3 w-3 mt-0.5 shrink-0" />
          <span className="font-medium flex-1">Q: {log.message}</span>
          {timestamp}
        </div>
      );
    case "answer":
      return (
        <div className="flex items-start gap-2 text-blue-600 dark:text-blue-400">
          <Send className="h-3 w-3 mt-0.5 shrink-0" />
          <span className="flex-1">A: {log.message}</span>
          {timestamp}
        </div>
      );
    case "todo":
      return null;
    case "done":
    case "executed":
      return (
        <div className="flex items-start gap-2 text-green-600 dark:text-green-400">
          <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0" />
          <span className="flex-1">{log.message}</span>
          {timestamp}
        </div>
      );
    case "low_confidence":
    case "error":
      return (
        <div className="flex items-start gap-2 text-red-600 dark:text-red-400">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          <span className="flex-1">{log.message}</span>
          {timestamp}
        </div>
      );
    default:
      return (
        <div className="flex items-start gap-2 text-muted-foreground">
          <span className="pl-5 flex-1">{log.message}</span>
          {timestamp}
        </div>
      );
  }
}

interface LogsPanelProps {
  cardId: number;
  liveLogs: ProcessingLog[];
  isLiveProcessing: boolean;
}

export function LogsPanel({ cardId, liveLogs, isLiveProcessing }: LogsPanelProps) {
  const [tab, setTab] = useState<"live" | "history">(isLiveProcessing ? "live" : "live");
  const [sessions, setSessions] = useState<ExecutionSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [sessionLogs, setSessionLogs] = useState<ProcessingLog[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showJumpButton, setShowJumpButton] = useState(false);

  const logsContainerRef = useRef<HTMLDivElement>(null);
  const bottomSentinelRef = useRef<HTMLDivElement>(null);

  // Auto-switch to live tab when processing starts
  useEffect(() => {
    if (isLiveProcessing) setTab("live");
  }, [isLiveProcessing]);

  // Load sessions when switching to history tab
  useEffect(() => {
    if (tab === "history") {
      api.getSessions(cardId).then(({ sessions: s }) => setSessions(s));
    }
  }, [tab, cardId]);

  // Load session logs when selecting a session
  useEffect(() => {
    if (selectedSessionId !== null) {
      api.getSessionLogs(selectedSessionId).then(({ logs }) => {
        setSessionLogs(
          logs.map((l: ExecutionLog) => ({
            step: l.step,
            message: l.message,
            data: l.data || undefined,
            timestamp: l.created_at,
          })),
        );
      });
    }
  }, [selectedSessionId]);

  // IntersectionObserver for auto-scroll detection
  useEffect(() => {
    const sentinel = bottomSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setShowJumpButton(!entry.isIntersecting),
      { threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  // Auto-scroll when new live logs arrive
  useEffect(() => {
    if (tab === "live" && !showJumpButton) {
      bottomSentinelRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [liveLogs.length, tab, showJumpButton]);

  const jumpToBottom = useCallback(() => {
    bottomSentinelRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const currentLogs = tab === "live" ? liveLogs : sessionLogs;
  const filteredLogs = searchQuery
    ? currentLogs.filter((l) => l.message.toLowerCase().includes(searchQuery.toLowerCase()))
    : currentLogs;

  const hasLogs = liveLogs.length > 0 || sessions.length > 0;
  if (!hasLogs && !isLiveProcessing) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium">Execution Logs</h3>
        {isLiveProcessing && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        <button
          onClick={() => setTab("live")}
          className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border-b-2 transition-colors ${
            tab === "live"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Radio className="h-3 w-3" />
          Live
          {isLiveProcessing && (
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
          )}
        </button>
        <button
          onClick={() => setTab("history")}
          className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border-b-2 transition-colors ${
            tab === "history"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <History className="h-3 w-3" />
          History
          {sessions.length > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1 py-0 ml-0.5">{sessions.length}</Badge>
          )}
        </button>
      </div>

      {/* Search */}
      {currentLogs.length > 5 && (
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter logs..."
            className="w-full pl-7 pr-2 py-1 rounded-md border border-input bg-background text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
      )}

      {/* History: session selector */}
      {tab === "history" && (
        <SessionList
          sessions={sessions}
          selectedSessionId={selectedSessionId}
          onSelectSession={setSelectedSessionId}
        />
      )}

      {/* Log entries */}
      <div ref={logsContainerRef} className="relative space-y-1.5 text-xs max-h-96 overflow-y-auto">
        {filteredLogs.map((log, i) => (
          <LogEntry key={i} log={log} />
        ))}
        <div ref={bottomSentinelRef} />

        {/* Jump to latest button */}
        {showJumpButton && tab === "live" && isLiveProcessing && (
          <button
            onClick={jumpToBottom}
            className="sticky bottom-1 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-1 rounded-full bg-primary text-primary-foreground text-[10px] font-medium shadow-md hover:bg-primary/90 transition-colors"
          >
            <ArrowDown className="h-3 w-3" />
            Jump to latest
          </button>
        )}
      </div>

      {tab === "live" && liveLogs.length === 0 && !isLiveProcessing && (
        <p className="text-xs text-muted-foreground py-2">No logs yet. Run an AI request to see logs.</p>
      )}

      {tab === "history" && selectedSessionId !== null && sessionLogs.length === 0 && (
        <p className="text-xs text-muted-foreground py-2">No logs for this session.</p>
      )}
    </div>
  );
}
