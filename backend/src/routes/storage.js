import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getStorageStatsFor } from '../utils/storage.js';

export const storageRouter = Router();

storageRouter.use(requireAuth);

storageRouter.get('/', (req, res) => {
  res.json(getStorageStatsFor(req.user));
});
