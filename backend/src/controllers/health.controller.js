import * as healthService from '../services/health.service.js';

export async function getHealth(req, res, next) {
  try {
    const data = await healthService.checkHealth();
    res.json(data);
  } catch (err) {
    next(err);
  }
}
