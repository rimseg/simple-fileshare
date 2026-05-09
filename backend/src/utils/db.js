import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dbPath = process.env.DB_PATH || './data/fileshare.db';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT UNIQUE NOT NULL,
    owner_id INTEGER NOT NULL,
    label TEXT,
    password_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    share_id INTEGER NOT NULL,
    relative_path TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    uploaded_at INTEGER NOT NULL,
    FOREIGN KEY (share_id) REFERENCES shares(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_shares_expires_at ON shares(expires_at);
  CREATE INDEX IF NOT EXISTS idx_shares_owner ON shares(owner_id);
  CREATE INDEX IF NOT EXISTS idx_files_share ON files(share_id);
`);

// Lightweight migrations: SQLite has no `ADD COLUMN IF NOT EXISTS`, so check first.
function ensureColumn(table, name, ddl) {
  const cols = db.prepare(`PRAGMA table_info('${table}')`).all();
  if (!cols.some((c) => c.name === name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
ensureColumn('shares', 'download_count', 'download_count INTEGER NOT NULL DEFAULT 0');
ensureColumn('shares', 'allow_guest_upload', 'allow_guest_upload INTEGER NOT NULL DEFAULT 0');
ensureColumn('shares', 'lifetime_days', 'lifetime_days INTEGER');
ensureColumn('shares', 'started_at', 'started_at INTEGER');

// Per-user quotas. 0 = no limit (admins create with infinite lifetime; users see global storage).
ensureColumn('users', 'max_lifetime_days', 'max_lifetime_days INTEGER NOT NULL DEFAULT 14');
ensureColumn('users', 'max_storage_bytes', 'max_storage_bytes INTEGER NOT NULL DEFAULT 0');

// Backfill lifetime_days/started_at for pre-existing rows (timer was already running for them).
db.exec(`
  UPDATE shares
     SET lifetime_days = MAX(1, CAST(ROUND((expires_at - created_at) / 86400000.0) AS INTEGER))
   WHERE lifetime_days IS NULL;
  UPDATE shares SET started_at = created_at WHERE started_at IS NULL AND expires_at > 0;
  UPDATE users SET max_lifetime_days = 0 WHERE role = 'admin' AND max_lifetime_days = 14;
`);
