CREATE TABLE IF NOT EXISTS execution_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'execution',
  status TEXT NOT NULL DEFAULT 'running',
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME,
  summary TEXT
);

CREATE INDEX IF NOT EXISTS idx_execution_sessions_card_id ON execution_sessions(card_id);

-- Add execution_session_id column to execution_logs if it doesn't exist
-- SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we use a pragma check
-- We'll handle this gracefully in the migration code
