import { Router } from 'express';
import bcrypt from 'bcrypt';
import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import { db } from '../utils/db.js';
import { signDownloadToken, verifyDownloadToken } from '../middleware/auth.js';
import { shareAuthLimiter } from '../middleware/rateLimit.js';

export const shareRouter = Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR || './data/uploads';

function findActiveShare(token) {
  const s = db.prepare('SELECT * FROM shares WHERE token = ?').get(token);
  if (!s) return null;
  if (s.expires_at <= Date.now()) return null;
  return s;
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
  if (share.expires_at <= Date.now()) {
    return res.status(410).json({ error: 'share expired' });
  }
  req.share = share;
  next();
}

shareRouter.get('/:token/info', (req, res) => {
  const share = findActiveShare(req.params.token);
  if (!share) return res.status(404).json({ error: 'link not found or expired' });
  res.json({ label: share.label, expires_at: share.expires_at });
});

shareRouter.post('/:token/auth', shareAuthLimiter, (req, res) => {
  const share = findActiveShare(req.params.token);
  if (!share) return res.status(404).json({ error: 'link not found or expired' });

  const { password } = req.body || {};
  if (!password || !bcrypt.compareSync(password, share.password_hash)) {
    return res.status(401).json({ error: 'invalid password' });
  }

  res.json({
    download_token: signDownloadToken(share.id),
    label: share.label,
    expires_at: share.expires_at,
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
