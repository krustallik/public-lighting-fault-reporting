import type { AdminUser } from './auth.js';

declare global {
  namespace Express {
    interface Request {
      admin?: AdminUser;
    }
  }
}

export {};
