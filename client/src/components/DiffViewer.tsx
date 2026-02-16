import { useState, useEffect, useRef } from "react";
import type { DiffResult, FileDiff } from "@daily-kanban/shared";
import { api } from "../lib/api";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, FileCode, FilePlus, FileMinus, FileEdit } from "lucide-react";

const statusIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  added: FilePlus,
  deleted: FileMinus,
  modified: FileEdit,
};

function DiffBlock({ file }: { file: FileDiff }) {
  const [expanded, setExpanded] = useState(false);

  const Icon = statusIcons[file.status] || FileCode;
  const statusColor = file.status === "added"
    ? "text-green-600 dark:text-green-400"
    : file.status === "deleted"
    ? "text-red-600 dark:text-red-400"
    : "text-blue-600 dark:text-blue-400";

  return (
    <div className="border rounded-md overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <Icon className={`h-3.5 w-3.5 shrink-0 ${statusColor}`} />
        <span className="flex-1 text-left font-mono truncate">{file.path}</span>
        <span className="text-green-600 dark:text-green-400 font-mono">+{file.additions}</span>
        <span className="text-red-600 dark:text-red-400 font-mono">-{file.deletions}</span>
      </button>

      {expanded && file.diff && (
        <div className="border-t bg-muted/20 overflow-x-auto">
          <pre className="text-[11px] leading-tight font-mono p-2">
            {file.diff.split("\n").map((line, i) => {
              let lineClass = "text-muted-foreground";
              if (line.startsWith("+") && !line.startsWith("+++")) {
                lineClass = "text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30";
              } else if (line.startsWith("-") && !line.startsWith("---")) {
                lineClass = "text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30";
              } else if (line.startsWith("@@")) {
                lineClass = "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/20";
              }
              return (
                <div key={i} className={`${lineClass} px-1 whitespace-pre`}>
                  {line}
                </div>
              );
            })}
          </pre>
        </div>
      )}
    </div>
  );
}

interface DiffViewerProps {
  cardId: number;
  isExecuting: boolean;
}

export function DiffViewer({ cardId, isExecuting }: DiffViewerProps) {
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchDiff = () => {
    api.getDiff(cardId).then(setDiff).catch(console.error);
  };

  useEffect(() => {
    fetchDiff();

    if (isExecuting) {
      intervalRef.current = setInterval(fetchDiff, 5000);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [cardId, isExecuting]);

  if (!diff || diff.files.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium">Code Changes</h3>
        <Badge variant="secondary" className="text-[10px]">
          {diff.stats.totalFiles} file{diff.stats.totalFiles !== 1 ? "s" : ""}
        </Badge>
        <span className="text-xs text-green-600 dark:text-green-400 font-mono">+{diff.stats.totalAdditions}</span>
        <span className="text-xs text-red-600 dark:text-red-400 font-mono">-{diff.stats.totalDeletions}</span>
      </div>
      <div className="space-y-1.5">
        {diff.files.map((file) => (
          <DiffBlock key={file.path} file={file} />
        ))}
      </div>
    </div>
  );
}
