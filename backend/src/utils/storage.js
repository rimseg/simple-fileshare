import { db } from './db.js';

export function getStorageStats() {
  const max = Number(process.env.MAX_STORAGE_BYTES || 10 * 1024 * 1024 * 1024);
  const row = db
    .prepare('SELECT COALESCE(SUM(size_bytes), 0) AS used FROM files')
    .get();
  const used = Number(row.used) || 0;
  return {
    used_bytes: used,
    max_bytes: max,
    available_bytes: Math.max(0, max - used),
  };
}
