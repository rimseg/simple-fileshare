import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

export function signSessionToken(user) {
  return jwt.sign(
    { uid: user.id, username: user.username, role: user.role, scope: 'session' },
    SECRET,
    { expiresIn: '12h' }
  );
}

function readBearer(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

function verify(req, res, expectedScope) {
  const token = readBearer(req);
  if (!token) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  try {
    const payload = jwt.verify(token, SECRET);
    if (expectedScope && payload.scope !== expectedScope) {
      res.status(401).json({ error: 'invalid scope' });
      return null;
    }
    return payload;
  } catch {
    res.status(401).json({ error: 'invalid token' });
    return null;
  }
}

export function requireAuth(req, res, next) {
  const payload = verify(req, res, 'session');
  if (!payload) return;
  req.user = payload;
  next();
}

export function requireAdmin(req, res, next) {
  const payload = verify(req, res, 'session');
  if (!payload) return;
  if (payload.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  req.user = payload;
  next();
}

export function signDownloadToken(shareId) {
  return jwt.sign({ share: shareId, scope: 'download' }, SECRET, { expiresIn: '2h' });
}

export function verifyDownloadToken(token) {
  try {
    const payload = jwt.verify(token, SECRET);
    if (payload.scope !== 'download') return null;
    return payload;
  } catch {
    return null;
  }
}
