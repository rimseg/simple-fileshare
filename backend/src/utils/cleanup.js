import fs from 'node:fs';
import path from 'node:path';
import cron from 'node-cron';
import { db } from './db.js';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './data/uploads';

export function deleteShareArtifacts(shareId, token) {
  const dir = path.join(UPLOAD_DIR, token);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  db.prepare('DELETE FROM shares WHERE id = ?').run(shareId);
}

export function purgeExpired() {
  const now = Date.now();
  // expires_at <= 0 is a sentinel: 0 = drop-mode timer not yet started, -1 = never expires.
  const expired = db
    .prepare('SELECT id, token FROM shares WHERE expires_at > 0 AND expires_at <= ?')
    .all(now);

  for (const s of expired) {
    try {
      deleteShareArtifacts(s.id, s.token);
      console.log(`[cleanup] purged expired share ${s.token}`);
    } catch (err) {
      console.error(`[cleanup] failed to purge ${s.token}:`, err);
    }
  }
  return expired.length;
}

export function startCleanupSchedule() {
  cron.schedule('0 * * * *', () => {
    const removed = purgeExpired();
    if (removed > 0) console.log(`[cleanup] removed ${removed} expired share(s)`);
  });
  purgeExpired();
}
