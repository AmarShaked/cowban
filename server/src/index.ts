import express from "express";
import cors from "cors";
import { getDb } from "./db/database.js";
import { BoardRepo } from "./db/board-repo.js";
import { CardRepo } from "./db/card-repo.js";
import { SettingsRepo } from "./db/settings-repo.js";
import { createBoardRouter } from "./routes/board.js";
import { createCardsRouter } from "./routes/cards.js";
import { createAiRouter } from "./routes/ai.js";
import { createSettingsRouter } from "./routes/settings.js";
import { createReposRouter } from "./routes/repos.js";
import { createConnectorsRouter, initializeConnector } from "./routes/connectors.js";
import { ConnectorRegistry } from "./connectors/registry.js";
import { GmailConnector } from "./connectors/gmail.js";
import { CalendarConnector } from "./connectors/calendar.js";
import { LinearConnector } from "./connectors/linear.js";
import { GitLabConnector } from "./connectors/gitlab.js";
import { TelegramConnector } from "./connectors/telegram.js";
import { ClaudeEvaluator } from "./ai/claude-evaluator.js";
import { Scheduler } from "./scheduler.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// --- Repos ---
const db = getDb();
const boardRepo = new BoardRepo(db);
const cardRepo = new CardRepo(db);
const settingsRepo = new SettingsRepo(db);

// --- Connectors ---
const registry = new ConnectorRegistry();
registry.register("gmail", new GmailConnector());
registry.register("calendar", new CalendarConnector());
registry.register("linear", new LinearConnector());
registry.register("gitlab", new GitLabConnector());
registry.register("telegram", new TelegramConnector());

// --- Load saved connector configs from DB ---
const savedConfigs = db.prepare(
  "SELECT * FROM connector_configs WHERE enabled = 1 AND credentials IS NOT NULL"
).all() as { type: string; credentials: string; settings: string | null }[];

for (const config of savedConfigs) {
  try {
    const credentials = JSON.parse(config.credentials);
    const settings = config.settings ? JSON.parse(config.settings) : null;
    initializeConnector(config.type, credentials, registry, boardRepo, cardRepo, settings);
    console.log(`Loaded saved config for connector: ${config.type}`);
  } catch (err) {
    console.error(`Failed to load config for connector ${config.type}:`, err);
  }
}

// --- AI ---
const evaluator = new ClaudeEvaluator();

// --- Routes ---
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/board", createBoardRouter(boardRepo, cardRepo));
app.use("/api/cards", createCardsRouter(cardRepo, boardRepo));
app.use("/api/ai", createAiRouter(cardRepo, evaluator, registry, db));
app.use("/api/settings", createSettingsRouter(settingsRepo));
app.use("/api/repos", createReposRouter(settingsRepo));
// --- Scheduler ---
const pollInterval = settingsRepo.get<number>("poll_interval_ms", 5 * 60 * 1000);
const scheduler = new Scheduler(registry, boardRepo, cardRepo, db);
scheduler.start(pollInterval);

app.use("/api/connectors", createConnectorsRouter({ db, registry, boardRepo, cardRepo, scheduler, port: Number(PORT) }));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

export default app;
