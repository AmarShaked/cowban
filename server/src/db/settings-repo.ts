import Database from "better-sqlite3";

export class SettingsRepo {
  constructor(private db: Database.Database) {}

  get<T>(key: string, defaultValue: T): T {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : defaultValue;
  }

  set(key: string, value: unknown): void {
    this.db
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
      .run(key, JSON.stringify(value));
  }
}
