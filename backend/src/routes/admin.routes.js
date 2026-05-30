import { Router } from 'express';
import * as adminController from '../controllers/admin.controller.js';

const router = Router();

router.post('/login', adminController.login);
router.get('/light-points', adminController.getLightPoints);
router.post('/light-points', adminController.createLightPoint);
router.put('/light-points/:id', adminController.updateLightPoint);
router.delete('/light-points/:id', adminController.deleteLightPoint);

export default router;
