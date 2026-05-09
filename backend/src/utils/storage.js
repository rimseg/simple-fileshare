import fs from 'node:fs';
import { db } from './db.js';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './data/uploads';

export function getStorageStats() {
  // Bytes used by uploaded files (tracked in DB).
  const row = db
    .prepare('SELECT COALESCE(SUM(size_bytes), 0) AS used FROM files')
    .get();
  const used = Number(row.used) || 0;

  // Real disk space on the filesystem hosting the upload directory.
  // statfs is sync and cheap; called on every storage stats request.
  let available;
  let total;
  try {
    const stat = fs.statfsSync(UPLOAD_DIR);
    available = Number(stat.bavail) * Number(stat.bsize);
    total = used + available;
  } catch {
    // Fall back to a conservative cap so the UI keeps working if statfs fails.
    total = used;
    available = 0;
  }

  return {
    used_bytes: used,
    max_bytes: total,
    available_bytes: Math.max(0, available),
  };
}
