import { Router } from 'express';
import bcrypt from 'bcrypt';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import { db } from '../utils/db.js';
import { signDownloadToken, verifyDownloadToken } from '../middleware/auth.js';
import { shareAuthLimiter } from '../middleware/rateLimit.js';
import { getStorageStats } from '../utils/storage.js';

export const shareRouter = Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR || './data/uploads';
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 2 * 1024 * 1024 * 1024);
const DAY_MS = 24 * 60 * 60 * 1000;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function isExpired(share) {
  return share.expires_at > 0 && share.expires_at <= Date.now();
}

function findActiveShare(token) {
  const s = db.prepare('SELECT * FROM shares WHERE token = ?').get(token);
  if (!s) return null;
  if (isExpired(s)) return null;
  return s;
}

function shareFileCount(shareId) {
  const row = db.prepare('SELECT COUNT(*) AS n FROM files WHERE share_id = ?').get(shareId);
  return Number(row?.n || 0);
}

function startTimerIfNeeded(share) {
  if (share.started_at != null || share.expires_at > 0) return share;
  const now = Date.now();
  const days = share.lifetime_days || 1;
  const expires_at = now + days * DAY_MS;
  db.prepare('UPDATE shares SET started_at = ?, expires_at = ? WHERE id = ?')
    .run(now, expires_at, share.id);
  return { ...share, started_at: now, expires_at };
}

function requireDownloadAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const fromHeader = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const fromQuery = typeof req.query.t === 'string' ? req.query.t : null;
  const token = fromHeader || fromQuery;
  const payload = token ? verifyDownloadToken(token) : null;
  if (!payload) return res.status(401).json({ error: 'unauthorized' });

  const share = db.prepare('SELECT * FROM shares WHERE id = ?').get(payload.share);
  if (!share || share.token !== req.params.token) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (isExpired(share)) {
    return res.status(410).json({ error: 'share expired' });
  }
  req.share = share;
  next();
}

shareRouter.get('/:token/info', (req, res) => {
  const share = findActiveShare(req.params.token);
  if (!share) return res.status(404).json({ error: 'link not found or expired' });
  res.json({
    label: share.label,
    expires_at: share.expires_at,
    allow_guest_upload: !!share.allow_guest_upload,
    started: share.started_at != null,
    lifetime_days: share.lifetime_days,
    has_files: shareFileCount(share.id) > 0,
  });
});

shareRouter.post('/:token/auth', shareAuthLimiter, (req, res) => {
  const share = findActiveShare(req.params.token);
  if (!share) return res.status(404).json({ error: 'link not found or expired' });

  const { password } = req.body || {};
  if (!password || !bcrypt.compareSync(password, share.password_hash)) {
    return res.status(401).json({ error: 'invalid password' });
  }

  const fileCount = shareFileCount(share.id);
  // Drop-mode: files have been uploaded — seal the dropbox and start the timer.
  let active = share;
  if (share.allow_guest_upload && share.started_at == null && fileCount > 0) {
    active = startTimerIfNeeded(share);
  }
  const canUpload = !!active.allow_guest_upload && active.started_at == null;

  res.json({
    download_token: signDownloadToken(active.id),
    label: active.label,
    expires_at: active.expires_at,
    allow_guest_upload: !!active.allow_guest_upload,
    started: active.started_at != null,
    can_upload: canUpload,
    has_files: fileCount > 0,
  });
});

shareRouter.get('/:token/files', requireDownloadAuth, (req, res) => {
  const files = db
    .prepare(
      'SELECT id, relative_path, size_bytes FROM files WHERE share_id = ? ORDER BY relative_path'
    )
    .all(req.share.id);
  res.json({
    label: req.share.label,
    expires_at: req.share.expires_at,
    allow_guest_upload: !!req.share.allow_guest_upload,
    started: req.share.started_at != null,
    can_upload: !!req.share.allow_guest_upload && req.share.started_at == null,
    files,
  });
});

shareRouter.get('/:token/files/:fileId/download', requireDownloadAuth, (req, res) => {
  const file = db
    .prepare('SELECT * FROM files WHERE id = ? AND share_id = ?')
    .get(Number(req.params.fileId), req.share.id);
  if (!file) return res.status(404).json({ error: 'not found' });

  const abs = path.join(UPLOAD_DIR, file.stored_path);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'file missing on disk' });

  startTimerIfNeeded(req.share);
  db.prepare('UPDATE shares SET download_count = download_count + 1 WHERE id = ?')
    .run(req.share.id);

  const downloadName = path.basename(file.relative_path);
  res.download(abs, downloadName);
});

shareRouter.get('/:token/zip', requireDownloadAuth, (req, res) => {
  const files = db
    .prepare('SELECT relative_path, stored_path FROM files WHERE share_id = ?')
    .all(req.share.id);
  if (files.length === 0) return res.status(404).json({ error: 'no files' });

  startTimerIfNeeded(req.share);
  db.prepare('UPDATE shares SET download_count = download_count + 1 WHERE id = ?')
    .run(req.share.id);

  const zipName = (req.share.label || 'share').replace(/[^\w.\- ]+/g, '_') + '.zip';
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('warning', (err) => console.warn('[zip] warning:', err));
  archive.on('error', (err) => {
    console.error('[zip] error:', err);
    if (!res.headersSent) res.status(500);
    res.end();
  });

  archive.pipe(res);
  for (const f of files) {
    const abs = path.join(UPLOAD_DIR, f.stored_path);
    if (fs.existsSync(abs)) archive.file(abs, { name: f.relative_path });
  }
  archive.finalize();
});

// --- Guest upload (drop-mode) ---

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

const guestUpload = multer({
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

shareRouter.post(
  '/:token/files',
  requireDownloadAuth,
  (req, res, next) => {
    if (!req.share.allow_guest_upload) {
      return res.status(403).json({ error: 'guest upload disabled for this share' });
    }
    if (req.share.started_at != null) {
      return res.status(409).json({ error: 'share is already active — uploads sealed' });
    }

    const contentLength = Number(req.headers['content-length'] || 0);
    if (contentLength > 0) {
      const stats = getStorageStats();
      if (stats.used_bytes + contentLength > stats.max_bytes) {
        return res.status(507).json({ error: 'Storage quota reached — upload rejected' });
      }
    }

    const headerRel = req.headers['x-relative-path'] || req.query.path || '';
    let decoded = headerRel;
    try { decoded = decodeURIComponent(headerRel); } catch { /* keep raw */ }
    const rel = sanitizeRelativePath(decoded);
    if (!rel) return res.status(400).json({ error: 'x-relative-path header required' });

    req.sanitizedRelative = rel;
    next();
  },
  guestUpload.single('file'),
  (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'no file uploaded' });

    const stored = path.relative(UPLOAD_DIR, req.file.path);

    const existing = db
      .prepare('SELECT id FROM files WHERE share_id = ? AND relative_path = ?')
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
