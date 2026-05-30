import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { loginRateLimit } from '../middleware/loginRateLimit.js';
import { requireAdmin } from '../middleware/requireAdmin.js';

const router = Router();

router.post('/login', loginRateLimit, authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);
router.get('/me', requireAdmin, authController.me);

export default router;
