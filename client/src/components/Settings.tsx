import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

interface ConnectorConfigUI {
  type: string;
  credentials: string | null;
  enabled: boolean;
}

export function Settings() {
  const [threshold, setThreshold] = useState(80);
  const [pollInterval, setPollInterval] = useState(5);
  const [connectors, setConnectors] = useState<ConnectorConfigUI[]>([]);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setThreshold(data.confidence_threshold);
        setPollInterval(data.poll_interval_ms / 60000);
      });
    fetch("/api/connectors")
      .then((r) => r.json())
      .then(setConnectors);
  }, []);

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
          <CardTitle className="text-base">Connectors</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {["gmail", "calendar", "linear", "gitlab", "telegram"].map((type) => {
            const config = connectors.find((c) => c.type === type);
            return (
              <div key={type} className="flex items-center justify-between py-2 border-b last:border-0">
                <div>
                  <p className="text-sm font-medium capitalize">{type}</p>
                  <p className="text-xs text-muted-foreground">
                    {config?.credentials ? "Configured" : "Not configured"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Button variant="outline" size="sm">
                    Configure
                  </Button>
                  <Switch checked={config?.enabled ?? false} />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
