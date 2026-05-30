import { Router } from 'express';
import * as reportsController from '../controllers/reports.controller.js';

const router = Router();

router.post('/send', reportsController.sendReport);

export default router;
