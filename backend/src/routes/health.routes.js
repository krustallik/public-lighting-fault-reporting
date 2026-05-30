import { Router } from 'express';
import * as healthController from '../controllers/health.controller.js';

const router = Router();

router.get('/health', healthController.getHealth);

export default router;
