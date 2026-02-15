import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function migrate(db: Database.Database): void {
  const sql = readFileSync(join(__dirname, "migrations", "001_initial.sql"), "utf-8");
  db.exec(sql);
}
