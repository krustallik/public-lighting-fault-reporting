import { Router } from 'express';
import { pool } from '../db/pool.js';
import { PostgresFaultHistoryStore } from '../services/faultReportHistory.service.js';
import { AppError } from '../utils/AppError.js';
import { getAdminDashboardOverview } from '../services/adminDashboard.service.js';
import { getReportAnalyticsSummary, listReportAnalytics } from '../services/adminReportAnalytics.service.js';

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
    const requestedOffset = request.query.offset === undefined ? 0 : Number(request.query.offset);
    if (request.query.page === undefined &&
      (!Number.isSafeInteger(requestedOffset) || requestedOffset < 0)) {
      throw new AppError(400, 'Invalid report history page.');
    }
    const page = request.query.page === undefined
      ? Math.floor(requestedOffset / limit) + 1
      : Number(request.query.page);
    const offset = (page - 1) * limit;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(page) || page < 1 ||
      !Number.isSafeInteger(offset) || offset < 0) {
      throw new AppError(400, 'Invalid report history page.');
    }
    const data = await history.listHistory({ limit, offset });
    response.json({ success: true, data: { ...data, pagination: { page, limit, total: data.total, totalPages: Math.ceil(data.total / limit) || 1 } } });
  } catch (error) {
    next(error);
  }
});

router.get('/analytics/summary', async (request, response, next) => {
  try {
    const period = typeof request.query.period === 'string' ? request.query.period : '7d';
    response.json({ success: true, data: await getReportAnalyticsSummary(period) });
  } catch (error) {
    next(error);
  }
});

router.get('/analytics', async (request, response, next) => {
  try {
    const page = request.query.page === undefined ? 1 : Number(request.query.page);
    const limit = request.query.limit === undefined ? 10 : Number(request.query.limit);
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new AppError(400, 'Invalid analytics pagination');
    }
    const sortOrder = typeof request.query.sortOrder === 'string' ? request.query.sortOrder : 'desc';
    if (!['asc', 'desc'].includes(sortOrder)) {
      throw new AppError(400, 'Invalid analytics filter');
    }
    const search = typeof request.query.search === 'string' ? request.query.search.slice(0, 100) : '';
    const status = typeof request.query.status === 'string' ? request.query.status : undefined;
    const data = await listReportAnalytics({
      period: typeof request.query.period === 'string' ? request.query.period : '7d', page, limit, search,
      status: status as 'active' | 'inactive' | 'maintenance' | undefined,
      order: sortOrder as 'asc' | 'desc',
    });
    response.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

export default router;
