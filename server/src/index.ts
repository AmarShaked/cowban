import express from "express";
import cors from "cors";
import { getDb } from "./db/database.js";
import { BoardRepo } from "./db/board-repo.js";
import { CardRepo } from "./db/card-repo.js";
import { createBoardRouter } from "./routes/board.js";
import { createCardsRouter } from "./routes/cards.js";
import { ClaudeEvaluator } from "./ai/claude-evaluator.js";
import { createAiRouter } from "./routes/ai.js";
import { ConnectorRegistry } from "./connectors/registry.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const db = getDb();
const boardRepo = new BoardRepo(db);
const cardRepo = new CardRepo(db);
const registry = new ConnectorRegistry();

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/board", createBoardRouter(boardRepo, cardRepo));
app.use("/api/cards", createCardsRouter(cardRepo, boardRepo));

const evaluator = new ClaudeEvaluator();
app.use("/api/ai", createAiRouter(cardRepo, evaluator, registry));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

export default app;
