import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function migrate(db: Database.Database): void {
  const sql1 = readFileSync(join(__dirname, "migrations", "001_initial.sql"), "utf-8");
  db.exec(sql1);
  const sql2 = readFileSync(join(__dirname, "migrations", "002_execution_logs.sql"), "utf-8");
  db.exec(sql2);
  // 003: Add position column to cards (idempotent)
  const cardCols = db.pragma("table_info(cards)") as { name: string }[];
  if (!cardCols.some((c) => c.name === "position")) {
    db.exec("ALTER TABLE cards ADD COLUMN position REAL DEFAULT 0");
    db.exec("UPDATE cards SET position = id WHERE position = 0");
  }
  const sql4 = readFileSync(join(__dirname, "migrations", "004_sessions.sql"), "utf-8");
  db.exec(sql4);

  // Add execution_session_id column to execution_logs if missing
  const columns = db.pragma("table_info(execution_logs)") as { name: string }[];
  if (!columns.some((c) => c.name === "execution_session_id")) {
    db.exec("ALTER TABLE execution_logs ADD COLUMN execution_session_id INTEGER REFERENCES execution_sessions(id)");
  }
}
