import { Router } from 'express';
import { pool } from '../db/pool.js';
import { PostgresFaultHistoryStore } from '../services/faultReportHistory.service.js';
import { AppError } from '../utils/AppError.js';
import { getAdminDashboardOverview } from '../services/adminDashboard.service.js';

const router = Router();
const history = new PostgresFaultHistoryStore(pool);

router.get('/overview', async (_request, response, next) => {
  try {
    response.json({ success: true, data: await getAdminDashboardOverview() });
  } catch (error) {
    next(error);
  }
});

router.get('/history', async (request, response, next) => {
  try {
    const limit = request.query.limit === undefined ? 25 : Number(request.query.limit);
    const offset = request.query.offset === undefined ? 0 : Number(request.query.offset);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
      !Number.isSafeInteger(offset) || offset < 0) {
      throw new AppError(400, 'Invalid report history page.');
    }
    const data = await history.listHistory({ limit, offset });
    response.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

export default router;
