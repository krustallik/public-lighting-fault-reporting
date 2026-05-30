import * as reportsService from '../services/reports.service.js';

export async function sendReport(req, res, next) {
  try {
    const result = await reportsService.sendFaultReport(req.body);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}
