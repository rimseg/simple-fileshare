import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { seedAdmin } from './utils/seed.js';
import { startCleanupSchedule } from './utils/cleanup.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { meRouter } from './routes/me.js';
import { shareRouter } from './routes/share.js';
import { storageRouter } from './routes/storage.js';

const app = express();

// We sit behind two trusted proxies (host nginx + compose proxy). Trusting
// X-Forwarded-For lets express-rate-limit key on the real client IP.
app.set('trust proxy', 2);

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, max_lifetime_days: Number(process.env.MAX_LIFETIME_DAYS || 30) });
});

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/me', meRouter);
app.use('/api/share', shareRouter);
app.use('/api/storage', storageRouter);

app.use((err, req, res, _next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'file too large' });
  }
  console.error(err);
  res.status(500).json({ error: 'internal server error' });
});

const PORT = Number(process.env.PORT || 3000);

seedAdmin();
startCleanupSchedule();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`fileshare backend listening on :${PORT}`);
});
