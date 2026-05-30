import * as lightPointsService from '../services/lightPoints.service.js';

export async function getAll(req, res, next) {
  try {
    const data = await lightPointsService.getAllLightPoints();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getById(req, res, next) {
  try {
    const data = await lightPointsService.getLightPointById(req.params.id);
    if (!data) {
      return res.status(404).json({ success: false, message: 'Light point not found' });
    }
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}
