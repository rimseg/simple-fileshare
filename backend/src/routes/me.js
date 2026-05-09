import { Router } from 'express';
import bcrypt from 'bcrypt';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { db } from '../utils/db.js';
import { requireAuth } from '../middleware/auth.js';
import { deleteShareArtifacts } from '../utils/cleanup.js';
import { getStorageStats } from '../utils/storage.js';
import { createShareLimiter } from '../middleware/rateLimit.js';

export const meRouter = Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR || './data/uploads';
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 2 * 1024 * 1024 * 1024);
const MAX_LIFETIME_DAYS = Number(process.env.MAX_LIFETIME_DAYS || 30);
const DAY_MS = 24 * 60 * 60 * 1000;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

meRouter.use(requireAuth);

function sanitizeSegment(s) {
  return s.replace(/[^\w.\- ]+/g, '_').slice(0, 200);
}
function sanitizeRelativePath(rel) {
  if (!rel || typeof rel !== 'string') return null;
  const normalized = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalized.split('/').filter((s) => s && s !== '.' && s !== '..');
  if (segments.length === 0) return null;
  return segments.map(sanitizeSegment).join('/');
}

function getOwnShare(shareId, ownerId) {
  return db
    .prepare('SELECT * FROM shares WHERE id = ? AND owner_id = ?')
    .get(shareId, ownerId);
}

meRouter.get('/shares', (req, res) => {
  const rows = db
    .prepare(
      `SELECT s.id, s.token, s.label, s.expires_at, s.created_at, s.download_count,
              COUNT(f.id) AS file_count,
              COALESCE(SUM(f.size_bytes), 0) AS total_bytes
       FROM shares s
       LEFT JOIN files f ON f.share_id = s.id
       WHERE s.owner_id = ?
       GROUP BY s.id
       ORDER BY s.created_at DESC`
    )
    .all(req.user.uid);
  res.json({ shares: rows, max_lifetime_days: MAX_LIFETIME_DAYS });
});

meRouter.post('/shares', createShareLimiter, (req, res) => {
  const { label, password, lifetime_days } = req.body || {};

  if (!password || typeof password !== 'string' || password.length < 4) {
    return res.status(400).json({ error: 'password (min 4 chars) required' });
  }
  const days = Number(lifetime_days);
  if (!Number.isFinite(days) || days <= 0 || days > MAX_LIFETIME_DAYS) {
    return res
      .status(400)
      .json({ error: `lifetime_days must be between 1 and ${MAX_LIFETIME_DAYS}` });
  }

  const token = nanoid(24);
  const password_hash = bcrypt.hashSync(password, 10);
  const now = Date.now();
  const expires_at = now + days * DAY_MS;

  const result = db
    .prepare(
      `INSERT INTO shares (token, owner_id, label, password_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(token, req.user.uid, label || null, password_hash, expires_at, now);

  fs.mkdirSync(path.join(UPLOAD_DIR, token), { recursive: true });

  res.status(201).json({
    id: result.lastInsertRowid,
    token,
    label: label || null,
    expires_at,
    created_at: now,
  });
});

meRouter.get('/shares/:id', (req, res) => {
  const share = getOwnShare(Number(req.params.id), req.user.uid);
  if (!share) return res.status(404).json({ error: 'not found' });

  const files = db
    .prepare(
      'SELECT id, relative_path, size_bytes, uploaded_at FROM files WHERE share_id = ? ORDER BY relative_path'
    )
    .all(share.id);

  res.json({
    share: {
      id: share.id,
      token: share.token,
      label: share.label,
      expires_at: share.expires_at,
      created_at: share.created_at,
    },
    files,
  });
});

meRouter.delete('/shares/:id', (req, res) => {
  const share = getOwnShare(Number(req.params.id), req.user.uid);
  if (!share) return res.status(404).json({ error: 'not found' });
  deleteShareArtifacts(share.id, share.token);
  res.status(204).end();
});

meRouter.put('/shares/:id/password', (req, res) => {
  const share = getOwnShare(Number(req.params.id), req.user.uid);
  if (!share) return res.status(404).json({ error: 'not found' });

  const { password } = req.body || {};
  if (!password || typeof password !== 'string' || password.length < 4) {
    return res.status(400).json({ error: 'password (min 4 chars) required' });
  }

  const password_hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE shares SET password_hash = ? WHERE id = ?').run(password_hash, share.id);
  res.status(204).end();
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const target = path.join(UPLOAD_DIR, req.share.token, path.dirname(req.sanitizedRelative));
      fs.mkdirSync(target, { recursive: true });
      cb(null, target);
    },
    filename: (req, file, cb) => cb(null, path.basename(req.sanitizedRelative)),
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

meRouter.post(
  '/shares/:id/files',
  (req, res, next) => {
    const share = getOwnShare(Number(req.params.id), req.user.uid);
    if (!share) return res.status(404).json({ error: 'not found' });
    if (share.expires_at <= Date.now()) {
      return res.status(410).json({ error: 'share expired' });
    }

    // Quota pre-check (Content-Length is slightly larger than file size due to
    // multipart envelope, so this errs on the conservative side).
    const contentLength = Number(req.headers['content-length'] || 0);
    if (contentLength > 0) {
      const stats = getStorageStats();
      if (stats.used_bytes + contentLength > stats.max_bytes) {
        return res.status(507).json({
          error: 'Storage quota reached — upload rejected',
        });
      }
    }

    const headerRel = req.headers['x-relative-path'] || req.query.path || '';
    let decoded = headerRel;
    try { decoded = decodeURIComponent(headerRel); } catch { /* keep raw */ }
    const rel = sanitizeRelativePath(decoded);
    if (!rel) return res.status(400).json({ error: 'x-relative-path header required' });

    req.share = share;
    req.sanitizedRelative = rel;
    next();
  },
  upload.single('file'),
  (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'no file uploaded' });

    const stored = path.relative(UPLOAD_DIR, req.file.path);

    // overwrite existing entry for the same relative_path (re-upload)
    const existing = db
      .prepare('SELECT id, stored_path FROM files WHERE share_id = ? AND relative_path = ?')
      .get(req.share.id, req.sanitizedRelative);
    if (existing) {
      db.prepare('DELETE FROM files WHERE id = ?').run(existing.id);
    }

    const result = db
      .prepare(
        `INSERT INTO files (share_id, relative_path, stored_path, size_bytes, uploaded_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(req.share.id, req.sanitizedRelative, stored, req.file.size, Date.now());

    res.status(201).json({
      id: result.lastInsertRowid,
      relative_path: req.sanitizedRelative,
      size_bytes: req.file.size,
    });
  }
);

meRouter.delete('/shares/:id/files/:fileId', (req, res) => {
  const share = getOwnShare(Number(req.params.id), req.user.uid);
  if (!share) return res.status(404).json({ error: 'not found' });

  const file = db
    .prepare('SELECT id, stored_path FROM files WHERE id = ? AND share_id = ?')
    .get(Number(req.params.fileId), share.id);
  if (!file) return res.status(404).json({ error: 'file not found' });

  const abs = path.join(UPLOAD_DIR, file.stored_path);
  if (fs.existsSync(abs)) fs.rmSync(abs, { force: true });
  db.prepare('DELETE FROM files WHERE id = ?').run(file.id);

  res.status(204).end();
});
