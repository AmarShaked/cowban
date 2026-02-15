import { Router } from "express";
import crypto from "crypto";
import Database from "better-sqlite3";
import { google } from "googleapis";
import type { ConnectorRegistry } from "../connectors/registry.js";
import type { GmailConnector } from "../connectors/gmail.js";
import type { CalendarConnector } from "../connectors/calendar.js";
import { LinearConnector } from "../connectors/linear.js";
import type { GitLabConnector } from "../connectors/gitlab.js";
import type { TelegramConnector } from "../connectors/telegram.js";
import type { BoardRepo } from "../db/board-repo.js";
import type { CardRepo } from "../db/card-repo.js";

interface PendingOAuth {
  type: string;
  client_id: string;
  client_secret: string;
  redirect_uri: string;
}

const pendingOAuth = new Map<string, PendingOAuth>();

interface ConnectorsRouterDeps {
  db: Database.Database;
  registry: ConnectorRegistry;
  boardRepo: BoardRepo;
  cardRepo: CardRepo;
  scheduler: { pollAll(): Promise<void> };
  port: number;
}

export function initializeConnector(
  type: string,
  credentials: Record<string, string>,
  registry: ConnectorRegistry,
  boardRepo: BoardRepo,
  cardRepo: CardRepo,
  settings?: Record<string, string> | null,
): void {
  const connector = registry.get(type);
  if (!connector) return;

  switch (type) {
    case "gmail":
    case "calendar": {
      const oauth2 = new google.auth.OAuth2(
        credentials.client_id,
        credentials.client_secret,
      );
      oauth2.setCredentials({ refresh_token: credentials.refresh_token });
      (connector as unknown as GmailConnector | CalendarConnector).setAuth(oauth2);
      break;
    }
    case "linear": {
      const lin = connector as unknown as LinearConnector;
      lin.setApiKey(credentials.api_key);
      lin.setProjectId(settings?.project_id ?? null);
      lin.setTeamId(settings?.team_id ?? null);
      break;
    }
    case "gitlab":
      (connector as unknown as GitLabConnector).configure(
        credentials.base_url || "https://gitlab.com",
        credentials.token,
      );
      break;
    case "telegram":
      (connector as unknown as TelegramConnector).configure(
        credentials.bot_token,
        boardRepo,
        cardRepo,
      );
      break;
  }
}

export function createConnectorsRouter(deps: ConnectorsRouterDeps): Router {
  const { db, registry, boardRepo, cardRepo, scheduler, port } = deps;
  const router = Router();

  // Trigger a poll cycle across all enabled connectors
  router.post("/poll", async (_req, res) => {
    try {
      await scheduler.pollAll();
      res.json({ success: true });
    } catch (err) {
      console.error("Manual poll failed:", err);
      res.status(500).json({ error: "Poll failed" });
    }
  });

  // --- OAuth callback (must be before /:type param routes) ---
  router.get("/oauth/callback", async (req, res) => {
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !state) {
      res.status(400).send("Missing code or state parameter");
      return;
    }

    const pending = pendingOAuth.get(state);
    if (!pending) {
      res.status(400).send("Invalid or expired OAuth state");
      return;
    }

    try {
      const oauth2 = new google.auth.OAuth2(
        pending.client_id,
        pending.client_secret,
        pending.redirect_uri,
      );
      const { tokens } = await oauth2.getToken(code);
      const refresh_token = tokens.refresh_token;
      if (!refresh_token) {
        res.status(400).send("No refresh token received. Please try again.");
        return;
      }

      const credentials = {
        client_id: pending.client_id,
        client_secret: pending.client_secret,
        refresh_token,
      };

      db.prepare(
        `INSERT OR REPLACE INTO connector_configs (type, credentials, settings, enabled)
         VALUES (?, ?, ?, 1)`
      ).run(pending.type, JSON.stringify(credentials), null);

      initializeConnector(pending.type, credentials, registry, boardRepo, cardRepo);

      pendingOAuth.delete(state);

      res.send(`
        <html>
          <body style="font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
            <div style="text-align: center;">
              <h2>Authorization successful!</h2>
              <p>You can close this tab and return to the app.</p>
            </div>
          </body>
        </html>
      `);
    } catch (err) {
      console.error("OAuth callback error:", err);
      pendingOAuth.delete(state);
      res.status(500).send("OAuth token exchange failed");
    }
  });

  // --- Linear teams endpoint (must be before /:type param routes) ---
  router.get("/linear/teams", async (_req, res) => {
    const connector = registry.get("linear");
    if (!connector) {
      res.status(400).json({ error: "Linear connector not registered" });
      return;
    }

    const lin = connector as unknown as LinearConnector;
    try {
      const teams = await lin.getTeams();
      res.json({ teams });
    } catch (err) {
      console.error("Failed to fetch Linear teams:", err);
      res.status(400).json({ error: "Linear not configured or failed to fetch teams" });
    }
  });

  // --- OAuth start endpoint ---
  router.post("/:type/oauth/start", (req, res) => {
    const { type } = req.params;
    if (type !== "gmail" && type !== "calendar") {
      res.status(400).json({ error: "OAuth flow only supported for gmail and calendar" });
      return;
    }

    const { credentials_json } = req.body;
    if (!credentials_json) {
      res.status(400).json({ error: "credentials_json is required" });
      return;
    }

    const creds = credentials_json.web || credentials_json.installed;
    if (!creds || !creds.client_id || !creds.client_secret) {
      res.status(400).json({ error: "Invalid credentials.json format" });
      return;
    }

    const redirect_uri = `http://localhost:${port}/api/connectors/oauth/callback`;
    const oauth2 = new google.auth.OAuth2(creds.client_id, creds.client_secret, redirect_uri);

    const scopes = type === "gmail"
      ? ["https://www.googleapis.com/auth/gmail.modify"]
      : ["https://www.googleapis.com/auth/calendar.readonly"];

    const state = crypto.randomUUID();
    const auth_url = oauth2.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: scopes,
      state,
    });

    pendingOAuth.set(state, {
      type,
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      redirect_uri,
    });

    res.json({ auth_url });
  });

  // List all connectors (credentials masked)
  router.get("/", (_req, res) => {
    const configs = db.prepare("SELECT * FROM connector_configs ORDER BY type").all();
    res.json(configs.map((c: any) => {
      let aiRules: string | null = null;
      if (c.settings) {
        try { aiRules = JSON.parse(c.settings).ai_rules || null; } catch { /* ignore */ }
      }
      return {
        ...c,
        credentials: c.credentials ? "configured" : null,
        enabled: Boolean(c.enabled),
        ai_rules: aiRules,
      };
    }));
  });

  // Get single connector config (full credentials for editing)
  router.get("/:type", (req, res) => {
    const { type } = req.params;
    const config = db.prepare("SELECT * FROM connector_configs WHERE type = ?").get(type) as any;

    if (!config) {
      res.status(404).json({ error: "Connector not found" });
      return;
    }

    res.json({
      ...config,
      credentials: config.credentials ? JSON.parse(config.credentials) : null,
      settings: config.settings ? JSON.parse(config.settings) : null,
      enabled: Boolean(config.enabled),
    });
  });

  // Update AI rules for a connector
  router.patch("/:type/ai-rules", (req, res) => {
    const { type } = req.params;
    const { ai_rules } = req.body;

    const existing = db.prepare("SELECT * FROM connector_configs WHERE type = ?").get(type) as any;

    if (existing) {
      const settings = existing.settings ? JSON.parse(existing.settings) : {};
      if (ai_rules) {
        settings.ai_rules = ai_rules;
      } else {
        delete settings.ai_rules;
      }
      db.prepare("UPDATE connector_configs SET settings = ? WHERE type = ?").run(
        JSON.stringify(settings), type
      );
    } else {
      const settings = ai_rules ? { ai_rules } : {};
      db.prepare(
        "INSERT INTO connector_configs (type, credentials, settings, enabled) VALUES (?, ?, ?, 0)"
      ).run(type, null, JSON.stringify(settings));
    }

    res.json({ success: true });
  });

  // Create/update connector config
  router.put("/:type", (req, res) => {
    const { type } = req.params;
    const { credentials, settings, enabled } = req.body;

    // If only toggling enabled, preserve existing credentials
    if (credentials === undefined) {
      const existing = db.prepare("SELECT * FROM connector_configs WHERE type = ?").get(type) as any;
      if (existing) {
        db.prepare(
          "UPDATE connector_configs SET enabled = ? WHERE type = ?"
        ).run(enabled ? 1 : 0, type);
      } else {
        db.prepare(
          `INSERT INTO connector_configs (type, credentials, settings, enabled) VALUES (?, ?, ?, ?)`
        ).run(type, null, null, enabled ? 1 : 0);
      }
      res.json({ success: true });
      return;
    }

    db.prepare(
      `INSERT OR REPLACE INTO connector_configs (type, credentials, settings, enabled)
       VALUES (?, ?, ?, ?)`
    ).run(
      type,
      credentials ? JSON.stringify(credentials) : null,
      settings ? JSON.stringify(settings) : null,
      enabled ? 1 : 0
    );

    res.json({ success: true });
  });

  // Reload connector with current DB config
  router.post("/:type/reload", (req, res) => {
    const { type } = req.params;
    const config = db.prepare("SELECT * FROM connector_configs WHERE type = ?").get(type) as any;

    if (!config || !config.credentials) {
      res.status(404).json({ error: "No config found for connector" });
      return;
    }

    try {
      const credentials = JSON.parse(config.credentials);
      const settings = config.settings ? JSON.parse(config.settings) : null;
      initializeConnector(type, credentials, registry, boardRepo, cardRepo, settings);
      console.log(`Connector ${type} reloaded successfully`);
      res.json({ success: true });
    } catch (err) {
      console.error(`Failed to reload connector ${type}:`, err);
      res.status(500).json({ error: "Failed to reload connector" });
    }
  });

  return router;
}
