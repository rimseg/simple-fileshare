import { Router } from 'express';
import bcrypt from 'bcrypt';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { db } from '../utils/db.js';
import { requireAuth } from '../middleware/auth.js';
import { deleteShareArtifacts } from '../utils/cleanup.js';
import { getRemainingForOwner } from '../utils/storage.js';
import { createShareLimiter } from '../middleware/rateLimit.js';
import { startTimerIfNeeded } from './share.js';

export const meRouter = Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR || './data/uploads';
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 2 * 1024 * 1024 * 1024);
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

function getCurrentUserRow(uid) {
  return db
    .prepare('SELECT id, username, role, max_lifetime_days, max_storage_bytes FROM users WHERE id = ?')
    .get(uid);
}

meRouter.get('/profile', (req, res) => {
  const u = getCurrentUserRow(req.user.uid);
  if (!u) return res.status(404).json({ error: 'not found' });
  res.json({
    id: u.id,
    username: u.username,
    role: u.role,
    max_lifetime_days: u.max_lifetime_days,
    max_storage_bytes: u.max_storage_bytes,
  });
});

meRouter.get('/shares', (req, res) => {
  const u = getCurrentUserRow(req.user.uid);
  const rows = db
    .prepare(
      `SELECT s.id, s.token, s.label, s.expires_at, s.created_at, s.download_count,
              s.allow_guest_upload, s.lifetime_days, s.started_at,
              COUNT(f.id) AS file_count,
              COALESCE(SUM(f.size_bytes), 0) AS total_bytes
       FROM shares s
       LEFT JOIN files f ON f.share_id = s.id
       WHERE s.owner_id = ?
       GROUP BY s.id
       ORDER BY s.created_at DESC`
    )
    .all(req.user.uid);
  res.json({ shares: rows, max_lifetime_days: u?.max_lifetime_days ?? 14 });
});

meRouter.post('/shares', createShareLimiter, (req, res) => {
  const { label, password, lifetime_days, allow_guest_upload } = req.body || {};

  if (!password || typeof password !== 'string' || password.length < 4) {
    return res.status(400).json({ error: 'password (min 4 chars) required' });
  }
  const u = getCurrentUserRow(req.user.uid);
  const userMax = Number(u?.max_lifetime_days ?? 14);
  const days = Number(lifetime_days);
  if (!Number.isFinite(days) || days < 0) {
    return res.status(400).json({ error: 'lifetime_days must be a non-negative integer' });
  }
  // days = 0 means "never expires" — only allowed when the user has no upper bound (max=0).
  if (days === 0 && userMax !== 0) {
    return res.status(400).json({ error: `lifetime_days must be between 1 and ${userMax}` });
  }
  if (userMax > 0 && days > userMax) {
    return res.status(400).json({ error: `lifetime_days must be between 1 and ${userMax}` });
  }

  const token = nanoid(24);
  const password_hash = bcrypt.hashSync(password, 10);
  const now = Date.now();
  const guestUpload = allow_guest_upload ? 1 : 0;
  // expires_at sentinels: -1 = never expires, 0 = drop-mode timer not started, >0 = real timestamp.
  let expires_at;
  let started_at;
  if (guestUpload) {
    expires_at = 0;
    started_at = null;
  } else if (days === 0) {
    expires_at = -1;
    started_at = now;
  } else {
    expires_at = now + days * DAY_MS;
    started_at = now;
  }

  const result = db
    .prepare(
      `INSERT INTO shares
         (token, owner_id, label, password_hash, expires_at, created_at,
          allow_guest_upload, lifetime_days, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      token, req.user.uid, label || null, password_hash,
      expires_at, now, guestUpload, days, started_at
    );

  fs.mkdirSync(path.join(UPLOAD_DIR, token), { recursive: true });

  res.status(201).json({
    id: result.lastInsertRowid,
    token,
    label: label || null,
    expires_at,
    created_at: now,
    allow_guest_upload: !!guestUpload,
    lifetime_days: days,
    started_at,
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
      allow_guest_upload: !!share.allow_guest_upload,
      lifetime_days: share.lifetime_days,
      started_at: share.started_at,
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
    if (share.expires_at > 0 && share.expires_at <= Date.now()) {
      return res.status(410).json({ error: 'share expired' });
    }

    // Quota pre-check (Content-Length is slightly larger than file size due to
    // multipart envelope, so this errs on the conservative side).
    const contentLength = Number(req.headers['content-length'] || 0);
    if (contentLength > 0) {
      const remaining = getRemainingForOwner(req.user.uid);
      if (contentLength > remaining) {
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

    // Drop shares: first upload starts the timer (no-op for normal shares).
    startTimerIfNeeded(req.share);

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
