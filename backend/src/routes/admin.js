import { Router } from 'express';
import bcrypt from 'bcrypt';
import { db } from '../utils/db.js';
import { requireAdmin } from '../middleware/auth.js';
import { deleteShareArtifacts } from '../utils/cleanup.js';

export const adminRouter = Router();

adminRouter.use(requireAdmin);

adminRouter.get('/shares', (req, res) => {
  const rows = db
    .prepare(
      `SELECT s.id, s.token, s.label, s.expires_at, s.created_at, s.download_count,
              s.allow_guest_upload, s.lifetime_days, s.started_at,
              u.id AS owner_id, u.username AS owner_username,
              COUNT(f.id) AS file_count,
              COALESCE(SUM(f.size_bytes), 0) AS total_bytes
       FROM shares s
       JOIN users u ON u.id = s.owner_id
       LEFT JOIN files f ON f.share_id = s.id
       GROUP BY s.id
       ORDER BY s.created_at DESC`
    )
    .all();
  res.json({ shares: rows });
});

adminRouter.delete('/shares/:id', (req, res) => {
  const share = db.prepare('SELECT id, token FROM shares WHERE id = ?').get(req.params.id);
  if (!share) return res.status(404).json({ error: 'not found' });
  deleteShareArtifacts(share.id, share.token);
  res.status(204).end();
});

adminRouter.get('/users', (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.id, u.username, u.role, u.created_at,
              (SELECT COUNT(*) FROM shares s WHERE s.owner_id = u.id) AS share_count
       FROM users u
       ORDER BY u.created_at DESC`
    )
    .all();
  res.json({ users: rows });
});

adminRouter.post('/users', (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || typeof username !== 'string' || !/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
    return res.status(400).json({ error: 'username must be 3-32 chars (a-z A-Z 0-9 . _ -)' });
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'password must be at least 6 chars' });
  }
  const finalRole = role === 'admin' ? 'admin' : 'user';

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'username already exists' });

  const hash = bcrypt.hashSync(password, 12);
  const result = db
    .prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)')
    .run(username, hash, finalRole, Date.now());

  res.status(201).json({
    id: result.lastInsertRowid,
    username,
    role: finalRole,
  });
});

adminRouter.put('/users/:id/password', (req, res) => {
  const id = Number(req.params.id);
  const { password } = req.body || {};
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'password must be at least 6 chars' });
  }
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'not found' });

  const hash = bcrypt.hashSync(password, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
  res.status(204).end();
});

adminRouter.delete('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  if (id === req.user.uid) return res.status(400).json({ error: 'cannot delete own account' });

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'not found' });

  // delete all share dirs first, then the user (cascades shares + files rows)
  const shares = db.prepare('SELECT id, token FROM shares WHERE owner_id = ?').all(id);
  for (const s of shares) deleteShareArtifacts(s.id, s.token);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);

  res.status(204).end();
});
