import { Router } from 'express';
import * as controller from '../controllers/adminIntegration.controller.js';

const router = Router();

router.get('/settings', controller.getSettings);

export default router;
