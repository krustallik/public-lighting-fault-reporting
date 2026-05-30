import * as adminService from '../services/admin.service.js';

export async function login(req, res, next) {
  try {
    const result = await adminService.login(req.body);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function getLightPoints(req, res, next) {
  try {
    const data = await adminService.getAdminLightPoints();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function createLightPoint(req, res, next) {
  try {
    const data = await adminService.createLightPoint(req.body);
    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function updateLightPoint(req, res, next) {
  try {
    const data = await adminService.updateLightPoint(req.params.id, req.body);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function deleteLightPoint(req, res, next) {
  try {
    await adminService.deleteLightPoint(req.params.id);
    res.json({ success: true, message: 'Light point deleted' });
  } catch (err) {
    next(err);
  }
}
