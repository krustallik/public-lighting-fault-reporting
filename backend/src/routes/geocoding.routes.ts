import { Router } from 'express';
import * as geocodingController from '../controllers/geocoding.controller.js';

const router = Router();

router.get('/reverse', geocodingController.reverse);

export default router;
