-- Market Ping - initial schema

CREATE TABLE IF NOT EXISTS users (
  chat_id        INTEGER PRIMARY KEY,
  username       TEXT,
  first_name     TEXT,
  subscribed     INTEGER DEFAULT 0,
  joined_at      INTEGER,
  blocked        INTEGER DEFAULT 0,
  last_manual_at INTEGER
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS snapshots (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at   INTEGER,
  hour_key     TEXT,
  message_html TEXT,
  data_json    TEXT
);

CREATE TABLE IF NOT EXISTS last_good (
  metric      TEXT PRIMARY KEY,
  value       REAL,
  source      TEXT,
  updated_at  INTEGER,
  approximate INTEGER DEFAULT 0
);

-- status: pending | done | skipped  (skipped = all sources failed, nothing was sent)
CREATE TABLE IF NOT EXISTS broadcast_log (
  hour_key   TEXT PRIMARY KEY,
  started_at INTEGER,
  total      INTEGER,
  sent       INTEGER DEFAULT 0,
  blocked    INTEGER DEFAULT 0,
  failed     INTEGER DEFAULT 0,
  status     TEXT DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_users_subscribed  ON users(subscribed);
CREATE INDEX IF NOT EXISTS idx_snapshots_created ON snapshots(created_at);
CREATE INDEX IF NOT EXISTS idx_snapshots_hourkey ON snapshots(hour_key);

INSERT OR IGNORE INTO settings(key, value) VALUES ('service_enabled', '1');
