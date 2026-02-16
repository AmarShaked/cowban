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
  const sql3 = readFileSync(join(__dirname, "migrations", "003_card_position.sql"), "utf-8");
  db.exec(sql3);
  const sql4 = readFileSync(join(__dirname, "migrations", "004_sessions.sql"), "utf-8");
  db.exec(sql4);

  // Add execution_session_id column to execution_logs if missing
  const columns = db.pragma("table_info(execution_logs)") as { name: string }[];
  if (!columns.some((c) => c.name === "execution_session_id")) {
    db.exec("ALTER TABLE execution_logs ADD COLUMN execution_session_id INTEGER REFERENCES execution_sessions(id)");
  }
}
