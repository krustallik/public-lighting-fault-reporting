import { Router } from 'express';
import * as controller from '../controllers/adminLogs.controller.js';

const router = Router();

router.get('/activity', controller.getActivityLogs);
router.get('/imports', controller.getImportBatches);
router.get('/integration', controller.getIntegrationLogs);

export default router;
