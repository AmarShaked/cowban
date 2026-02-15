import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ArrowLeft, RefreshCw, ChevronDown, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ConnectorConfigDialog } from "./ConnectorConfigDialog";

type ConnectorType = "gmail" | "calendar" | "linear" | "gitlab" | "telegram";

interface ConnectorConfigUI {
  type: string;
  credentials: string | null;
  enabled: boolean;
  ai_rules: string | null;
}

const CONNECTOR_TYPES: ConnectorType[] = ["gmail", "calendar", "linear", "gitlab", "telegram"];

export function Settings() {
  const [threshold, setThreshold] = useState(80);
  const [pollInterval, setPollInterval] = useState(5);
  const [connectors, setConnectors] = useState<ConnectorConfigUI[]>([]);
  const [dialogType, setDialogType] = useState<ConnectorType | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [polling, setPolling] = useState(false);
  const [aiRules, setAiRules] = useState<Record<string, string>>({});
  const [expandedRules, setExpandedRules] = useState<Record<string, boolean>>({});
  const [repos, setRepos] = useState<{ id: string; name: string; path: string }[]>([]);
  const [defaultRepoId, setDefaultRepoId] = useState<string | null>(null);
  const [newRepoName, setNewRepoName] = useState("");
  const [newRepoPath, setNewRepoPath] = useState("");

  const fetchConnectors = useCallback(() => {
    fetch("/api/connectors")
      .then((r) => r.json())
      .then((data: ConnectorConfigUI[]) => {
        setConnectors(data);
        const rules: Record<string, string> = {};
        for (const c of data) {
          if (c.ai_rules) rules[c.type] = c.ai_rules;
        }
        setAiRules((prev) => {
          const merged = { ...rules };
          // Preserve unsaved local edits
          for (const [k, v] of Object.entries(prev)) {
            if (!(k in merged)) merged[k] = v;
          }
          return merged;
        });
      });
  }, []);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setThreshold(data.confidence_threshold);
        setPollInterval(data.poll_interval_ms / 60000);
      });
    fetch("/api/repos")
      .then((r) => r.json())
      .then((data) => {
        setRepos(data.repos);
        setDefaultRepoId(data.default_repo_id);
      });
    fetchConnectors();
  }, [fetchConnectors]);

  const saveSettings = async () => {
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confidence_threshold: threshold,
        poll_interval_ms: pollInterval * 60000,
      }),
    });
  };

  const handleToggle = async (type: string, enabled: boolean) => {
    try {
      const res = await fetch(`/api/connectors/${type}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("Failed to update");
      fetchConnectors();
    } catch {
      toast.error("Failed to update connector");
    }
  };

  const handlePollAll = async () => {
    setPolling(true);
    try {
      const res = await fetch("/api/connectors/poll", { method: "POST" });
      if (!res.ok) throw new Error("Poll failed");
      toast.success("Poll cycle completed");
    } catch {
      toast.error("Failed to poll connectors");
    } finally {
      setPolling(false);
    }
  };

  const handleSaveAiRules = async (type: string) => {
    try {
      const res = await fetch(`/api/connectors/${type}/ai-rules`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ai_rules: aiRules[type] || "" }),
      });
      if (!res.ok) throw new Error("Failed to save");
      toast.success(`AI rules saved for ${type}`);
    } catch {
      toast.error("Failed to save AI rules");
    }
  };

  const handleAddRepo = async () => {
    if (!newRepoName || !newRepoPath) return;
    try {
      const res = await fetch("/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newRepoName, path: newRepoPath }),
      });
      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error || "Failed to add repo");
        return;
      }
      const repo = await res.json();
      setRepos((prev) => [...prev, repo]);
      setNewRepoName("");
      setNewRepoPath("");
      toast.success("Repository added");
    } catch {
      toast.error("Failed to add repo");
    }
  };

  const handleDeleteRepo = async (id: string) => {
    try {
      await fetch(`/api/repos/${id}`, { method: "DELETE" });
      setRepos((prev) => prev.filter((r) => r.id !== id));
      if (defaultRepoId === id) setDefaultRepoId(null);
      toast.success("Repository removed");
    } catch {
      toast.error("Failed to remove repo");
    }
  };

  const handleSetDefaultRepo = async (repoId: string) => {
    const value = repoId || null;
    await fetch("/api/repos/default", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo_id: value }),
    });
    setDefaultRepoId(value);
  };

  const handleConfigure = (type: ConnectorType) => {
    setDialogType(type);
    setDialogOpen(true);
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-lg font-bold">Settings</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium">Confidence Threshold (%)</label>
            <Input
              type="number"
              min={0}
              max={100}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="text-sm font-medium">Poll Interval (minutes)</label>
            <Input
              type="number"
              min={1}
              max={60}
              value={pollInterval}
              onChange={(e) => setPollInterval(Number(e.target.value))}
            />
          </div>
          <Button onClick={saveSettings}>Save</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Repositories</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {repos.length > 0 && (
            <div className="space-y-2">
              {repos.map((repo) => (
                <div key={repo.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <p className="text-sm font-medium">{repo.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{repo.path}</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => handleDeleteRepo(repo.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Add Repository</label>
            <div className="flex gap-2">
              <Input
                placeholder="Name"
                value={newRepoName}
                onChange={(e) => setNewRepoName(e.target.value)}
                className="flex-1"
              />
              <Input
                placeholder="/path/to/repo"
                value={newRepoPath}
                onChange={(e) => setNewRepoPath(e.target.value)}
                className="flex-[2]"
              />
              <Button size="sm" onClick={handleAddRepo}>Add</Button>
            </div>
          </div>

          {repos.length > 0 && (
            <div>
              <label className="text-sm font-medium">Default Repository</label>
              <select
                value={defaultRepoId || ""}
                onChange={(e) => handleSetDefaultRepo(e.target.value)}
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">None</option>
                {repos.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Connectors</CardTitle>
          <Button variant="outline" size="sm" onClick={handlePollAll} disabled={polling}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${polling ? "animate-spin" : ""}`} />
            {polling ? "Polling..." : "Refresh All"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {CONNECTOR_TYPES.map((type) => {
            const config = connectors.find((c) => c.type === type);
            const isExpanded = expandedRules[type] ?? false;
            return (
              <div key={type} className="border-b last:border-0 py-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium capitalize">{type}</p>
                    <p className="text-xs text-muted-foreground">
                      {config?.credentials ? "Configured" : "Not configured"}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Button variant="outline" size="sm" onClick={() => handleConfigure(type)}>
                      Configure
                    </Button>
                    <Switch
                      checked={config?.enabled ?? false}
                      onCheckedChange={(checked) => handleToggle(type, checked)}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setExpandedRules((prev) => ({ ...prev, [type]: !prev[type] }))}
                  className="flex items-center gap-1 mt-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? "" : "-rotate-90"}`} />
                  AI Rules {aiRules[type] ? "(configured)" : ""}
                </button>
                {isExpanded && (
                  <div className="mt-2 space-y-2">
                    <textarea
                      value={aiRules[type] || ""}
                      onChange={(e) => setAiRules((prev) => ({ ...prev, [type]: e.target.value }))}
                      placeholder={`Default AI instructions for ${type} items, e.g. "If it's a calendar event notification, delete the email"`}
                      rows={3}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                    <Button size="sm" variant="outline" onClick={() => handleSaveAiRules(type)}>
                      Save Rules
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <ConnectorConfigDialog
        connectorType={dialogType}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={fetchConnectors}
      />
    </div>
  );
}
