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
