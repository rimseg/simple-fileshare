import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getStorageStats } from '../utils/storage.js';

export const storageRouter = Router();

storageRouter.use(requireAuth);

storageRouter.get('/', (req, res) => {
  res.json(getStorageStats());
});
