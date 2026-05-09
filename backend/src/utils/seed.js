import bcrypt from 'bcrypt';
import { db } from './db.js';

export function seedAdmin() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    console.warn('[seed] ADMIN_USERNAME / ADMIN_PASSWORD not set — skipping admin seed.');
    return;
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    console.log(`[seed] admin "${username}" already exists`);
    return;
  }

  const hash = bcrypt.hashSync(password, 12);
  db.prepare(
    'INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)'
  ).run(username, hash, 'admin', Date.now());

  console.log(`[seed] created admin user "${username}"`);
}
