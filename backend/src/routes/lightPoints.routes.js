import { Router } from 'express';
import * as lightPointsController from '../controllers/lightPoints.controller.js';

const router = Router();

router.get('/', lightPointsController.getAll);
router.get('/:id', lightPointsController.getById);

export default router;
