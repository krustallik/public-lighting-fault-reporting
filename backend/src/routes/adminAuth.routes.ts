import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { loginRateLimit } from '../middleware/loginRateLimit.js';

const router = Router();

router.post('/login', loginRateLimit, authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);
router.get('/me', authController.me);

export default router;
