import { Router } from 'express';
import adminAuthRoutes from './adminAuth.routes.js';
import adminStreetLightsRoutes from './adminStreetLights.routes.js';
import adminLogsRoutes from './adminLogs.routes.js';
import adminIntegrationRoutes from './adminIntegration.routes.js';
import { requireAdmin } from '../middleware/requireAdmin.js';

const router = Router();

router.use('/auth', adminAuthRoutes);

router.use(requireAdmin);
router.use('/street-lights', adminStreetLightsRoutes);
router.use('/logs', adminLogsRoutes);
router.use('/integration', adminIntegrationRoutes);

export default router;
