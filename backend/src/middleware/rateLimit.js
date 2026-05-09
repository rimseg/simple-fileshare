import rateLimit from 'express-rate-limit';

const fifteenMin = 15 * 60 * 1000;

export const loginLimiter = rateLimit({
  windowMs: fifteenMin,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only count failures
  message: {
    error: 'Too many login attempts — please try again in 15 minutes.',
  },
});

// Per (IP + share token) — an attacker has to brute-force each token separately
// and from each IP, raising the cost meaningfully.
export const shareAuthLimiter = rateLimit({
  windowMs: fifteenMin,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${req.ip}:${req.params.token || ''}`,
  message: {
    error: 'Too many attempts for this link — please try again in 15 minutes.',
  },
});

// Protect the create-share endpoint from a hijacked session being used to spam
// links (low cost per share, but still worth bounding).
export const createShareLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many shares created in a short period.' },
});
