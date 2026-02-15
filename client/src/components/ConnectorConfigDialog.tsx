import { useState, useEffect, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type ConnectorType = "gmail" | "calendar" | "linear" | "gitlab" | "telegram";

interface FieldDef {
  key: string;
  label: string;
  placeholder: string;
  type?: string;
  group?: "credentials" | "settings";
  optional?: boolean;
}

const CONNECTOR_FIELDS: Record<ConnectorType, FieldDef[]> = {
  gmail: [],
  calendar: [],
  linear: [
    { key: "api_key", label: "API Key", placeholder: "lin_api_...", type: "password" },
    { key: "project_id", label: "Project ID", placeholder: "Project UUID (optional — leave empty for all)", group: "settings", optional: true },
  ],
  gitlab: [
    { key: "base_url", label: "Base URL", placeholder: "https://gitlab.com" },
    { key: "token", label: "Personal Access Token", placeholder: "glpat-...", type: "password" },
  ],
  telegram: [
    { key: "bot_token", label: "Bot Token", placeholder: "123456:ABC-DEF...", type: "password" },
  ],
};

const OAUTH_CONNECTORS = new Set<ConnectorType>(["gmail", "calendar"]);

interface ConnectorConfigDialogProps {
  connectorType: ConnectorType | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

function GoogleOAuthFlow({
  connectorType,
  isConfigured,
  onAuthorized,
}: {
  connectorType: "gmail" | "calendar";
  isConfigured: boolean;
  onAuthorized: () => void;
}) {
  const [credentialsJson, setCredentialsJson] = useState<object | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [authorizing, setAuthorizing] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  useEffect(() => {
    return stopPolling;
  }, [stopPolling]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target?.result as string);
        setCredentialsJson(json);
      } catch {
        toast.error("Invalid JSON file");
        setCredentialsJson(null);
      }
    };
    reader.readAsText(file);
  };

  const handleAuthorize = async () => {
    if (!credentialsJson) return;

    setAuthorizing(true);
    try {
      const res = await fetch(`/api/connectors/${connectorType}/oauth/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentials_json: credentialsJson }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to start OAuth");
      }

      const { auth_url } = await res.json();
      window.open(auth_url, "_blank");

      // Poll for completion
      pollingRef.current = setInterval(async () => {
        try {
          const check = await fetch(`/api/connectors/${connectorType}`);
          if (!check.ok) return;
          const data = await check.json();
          if (data.credentials) {
            stopPolling();
            setAuthorizing(false);
            toast.success(`${connectorType} authorized successfully`);
            onAuthorized();
          }
        } catch {
          // ignore polling errors
        }
      }, 2000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "OAuth failed");
      setAuthorizing(false);
    }
  };

  return (
    <div className="space-y-4 py-2">
      {isConfigured && (
        <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30 rounded-md px-3 py-2">
          <span>Authorized</span>
        </div>
      )}

      <div>
        <label className="text-sm font-medium">Google credentials.json</label>
        <Input
          type="file"
          accept=".json"
          onChange={handleFileChange}
          className="mt-1"
        />
        {fileName && (
          <p className="text-xs text-muted-foreground mt-1">{fileName}</p>
        )}
      </div>

      <Button
        onClick={handleAuthorize}
        disabled={!credentialsJson || authorizing}
        className="w-full"
      >
        {authorizing ? "Waiting for authorization..." : "Authorize with Google"}
      </Button>

      {authorizing && (
        <p className="text-xs text-muted-foreground text-center">
          Complete authorization in the opened tab. This dialog will update automatically.
        </p>
      )}
    </div>
  );
}

function LinearTeamSelect({
  value,
  onChange,
  apiKey,
}: {
  value: string;
  onChange: (value: string) => void;
  apiKey: string;
}) {
  const [teams, setTeams] = useState<{ id: string; name: string; key: string }[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(false);

  useEffect(() => {
    if (!apiKey) {
      setTeams([]);
      return;
    }

    setLoadingTeams(true);
    fetch("/api/connectors/linear/teams")
      .then((r) => {
        if (!r.ok) return null;
        return r.json();
      })
      .then((data) => {
        if (data?.teams) {
          setTeams(data.teams);
        }
      })
      .catch(() => {
        // ignore - API key might not be configured yet
      })
      .finally(() => setLoadingTeams(false));
  }, [apiKey]);

  if (!apiKey) return null;

  return (
    <div>
      <label className="text-sm font-medium">Team</label>
      {loadingTeams ? (
        <p className="text-sm text-muted-foreground mt-1">Loading teams...</p>
      ) : (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring mt-1"
        >
          <option value="">All Teams</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name} ({team.key})
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export function ConnectorConfigDialog({
  connectorType,
  open,
  onOpenChange,
  onSaved,
}: ConnectorConfigDialogProps) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);

  useEffect(() => {
    if (!open || !connectorType) {
      setFields({});
      setIsConfigured(false);
      return;
    }

    setLoading(true);
    fetch(`/api/connectors/${connectorType}`)
      .then((r) => {
        if (!r.ok) return null;
        return r.json();
      })
      .then((data) => {
        const defaults: Record<string, string> = {};
        for (const field of CONNECTOR_FIELDS[connectorType]) {
          defaults[field.key] = "";
        }
        if (connectorType === "gitlab") {
          defaults.base_url = "https://gitlab.com";
        }

        if (data?.credentials) {
          setIsConfigured(true);
          if (!OAUTH_CONNECTORS.has(connectorType)) {
            Object.assign(defaults, data.credentials);
          }
        }
        if (data?.settings) {
          Object.assign(defaults, data.settings);
        }
        setFields(defaults);
      })
      .finally(() => setLoading(false));
  }, [open, connectorType]);

  if (!connectorType) return null;

  const isOAuth = OAUTH_CONNECTORS.has(connectorType);
  const fieldDefs = CONNECTOR_FIELDS[connectorType];

  const handleSave = async () => {
    // Validate that required fields are filled
    const empty = fieldDefs.filter((f) => !f.optional && !fields[f.key]?.trim());
    if (empty.length > 0) {
      toast.error(`Please fill in: ${empty.map((f) => f.label).join(", ")}`);
      return;
    }

    // Split fields into credentials and settings
    const credentials: Record<string, string> = {};
    const settings: Record<string, string> = {};
    for (const field of fieldDefs) {
      const value = fields[field.key] || "";
      if (field.group === "settings") {
        if (value) settings[field.key] = value;
      } else {
        credentials[field.key] = value;
      }
    }

    // For linear, also include team_id in settings
    if (connectorType === "linear" && fields.team_id) {
      settings.team_id = fields.team_id;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/connectors/${connectorType}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credentials,
          settings: Object.keys(settings).length > 0 ? settings : null,
          enabled: true,
        }),
      });

      if (!res.ok) throw new Error("Failed to save");

      // Reload the connector on the server
      await fetch(`/api/connectors/${connectorType}/reload`, {
        method: "POST",
      });

      toast.success(`${connectorType} configured successfully`);
      onOpenChange(false);
      onSaved();
    } catch {
      toast.error("Failed to save connector configuration");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="capitalize">Configure {connectorType}</DialogTitle>
          <DialogDescription>
            {isOAuth
              ? `Upload your Google Cloud credentials.json to authorize ${connectorType}.`
              : `Enter the credentials for your ${connectorType} integration.`}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground py-4">Loading...</p>
        ) : isOAuth ? (
          <GoogleOAuthFlow
            connectorType={connectorType as "gmail" | "calendar"}
            isConfigured={isConfigured}
            onAuthorized={() => {
              onOpenChange(false);
              onSaved();
            }}
          />
        ) : (
          <div className="space-y-4 py-2">
            {fieldDefs.map((field) => (
              <div key={field.key}>
                <label className="text-sm font-medium">{field.label}</label>
                <Input
                  type={field.type || "text"}
                  placeholder={field.placeholder}
                  value={fields[field.key] || ""}
                  onChange={(e) =>
                    setFields((prev) => ({ ...prev, [field.key]: e.target.value }))
                  }
                />
              </div>
            ))}

            {connectorType === "linear" && (
              <LinearTeamSelect
                value={fields.team_id || ""}
                onChange={(value) =>
                  setFields((prev) => ({ ...prev, team_id: value }))
                }
                apiKey={fields.api_key || ""}
              />
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {!isOAuth && (
            <Button onClick={handleSave} disabled={saving || loading}>
              {saving ? "Saving..." : "Save"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
