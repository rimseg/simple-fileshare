import fs from 'node:fs';
import { db } from './db.js';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './data/uploads';

function envMaxStorage() {
  const v = Number(process.env.MAX_STORAGE_BYTES || 0);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

// System-wide stats: real disk minus what's used, optionally capped by MAX_STORAGE_BYTES.
export function getSystemStorageStats() {
  const row = db
    .prepare('SELECT COALESCE(SUM(size_bytes), 0) AS used FROM files')
    .get();
  const used = Number(row.used) || 0;

  let realAvailable = 0;
  try {
    const stat = fs.statfsSync(UPLOAD_DIR);
    realAvailable = Number(stat.bavail) * Number(stat.bsize);
  } catch {
    realAvailable = 0;
  }

  const realTotal = used + realAvailable;
  const cap = envMaxStorage();
  // cap is a hard ceiling; the actual limit is whichever is smaller (you can't
  // exceed real disk even if the env var allows it).
  const max_bytes = cap > 0 ? Math.min(cap, realTotal) : realTotal;

  return {
    used_bytes: used,
    max_bytes,
    available_bytes: Math.max(0, max_bytes - used),
    scope: 'system',
  };
}

// Per-user stats: bytes used across the user's shares vs their personal cap.
export function getUserStorageStats(userId, maxStorageBytes) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(f.size_bytes), 0) AS used
         FROM files f
         JOIN shares s ON s.id = f.share_id
        WHERE s.owner_id = ?`
    )
    .get(userId);
  const used = Number(row.used) || 0;

  // User's max is also bounded by what the system actually has available on disk.
  const sys = getSystemStorageStats();
  const effectiveMax = Math.min(maxStorageBytes, sys.max_bytes);

  return {
    used_bytes: used,
    max_bytes: effectiveMax,
    available_bytes: Math.max(0, effectiveMax - used),
    scope: 'user',
  };
}

// What the storage panel should show for the given user.
// Admins always see system; users with max_storage_bytes=0 also see system.
export function getStorageStatsFor(user) {
  const row = db
    .prepare('SELECT role, max_storage_bytes FROM users WHERE id = ?')
    .get(user.uid);
  const role = row?.role || user.role;
  const maxBytes = Number(row?.max_storage_bytes || 0);

  if (role === 'admin' || maxBytes === 0) {
    return getSystemStorageStats();
  }
  return getUserStorageStats(user.uid, maxBytes);
}

// Bytes available for a fresh upload by the given owner: the smaller of system
// remaining and (if applicable) the owner's personal remaining.
export function getRemainingForOwner(ownerId) {
  const sys = getSystemStorageStats();
  const sysRemaining = Math.max(0, sys.max_bytes - sys.used_bytes);

  const row = db
    .prepare('SELECT role, max_storage_bytes FROM users WHERE id = ?')
    .get(ownerId);
  if (!row) return 0;

  const maxBytes = Number(row.max_storage_bytes || 0);
  if (row.role === 'admin' || maxBytes === 0) return sysRemaining;

  const userStats = getUserStorageStats(ownerId, maxBytes);
  const userRemaining = Math.max(0, userStats.max_bytes - userStats.used_bytes);
  return Math.min(sysRemaining, userRemaining);
}
