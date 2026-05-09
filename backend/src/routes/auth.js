import { Router } from 'express';
import bcrypt from 'bcrypt';
import { db } from '../utils/db.js';
import { signSessionToken } from '../middleware/auth.js';
import { loginLimiter } from '../middleware/rateLimit.js';

export const authRouter = Router();

authRouter.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'invalid credentials' });
  }

  const token = signSessionToken(user);
  res.json({
    token,
    user: { id: user.id, username: user.username, role: user.role },
  });
});
