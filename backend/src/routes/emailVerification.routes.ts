import { Router, type Request, type Response } from 'express';
import type { EmailVerificationService } from '../services/emailVerification.service.js';

const INTENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key));
}

function sendError(response: Response, status: number, code: string, retryAfterSeconds?: number): void {
  response.setHeader('Cache-Control', 'no-store');
  if (retryAfterSeconds !== undefined) response.setHeader('Retry-After', String(retryAfterSeconds));
  response.status(status).json({ success: false, error: { code } });
}

function ipAddress(request: Request): string {
  return request.ip || request.socket.remoteAddress || 'unknown';
}

export function createEmailVerificationRouter(
  enabled: boolean,
  service?: EmailVerificationService
) {
  const router = Router();

  router.get('/email-verification/status', (_request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.json({ enabled });
  });

  router.post('/email-verification/request', async (request, response) => {
    if (!enabled || !service) {
      sendError(response, 404, 'EMAIL_VERIFICATION_DISABLED');
      return;
    }
    const body: unknown = request.body;
    if (!isRecord(body) || !hasOnlyKeys(body, ['email', 'locale'], ['intentId']) ||
      typeof body.email !== 'string' || body.email.length > 320 ||
      (body.locale !== 'sk' && body.locale !== 'en') ||
      (body.intentId !== undefined && (typeof body.intentId !== 'string' || !INTENT_ID.test(body.intentId)))) {
      sendError(response, 400, 'EMAIL_VERIFICATION_INVALID_REQUEST');
      return;
    }
    try {
      const result = await service.requestCode({
        email: body.email,
        ...(typeof body.intentId === 'string' ? { intentId: body.intentId } : {}),
        locale: body.locale,
        ipAddress: ipAddress(request),
      });
      switch (result.status) {
        case 'sent':
          response.setHeader('Cache-Control', 'no-store');
          response.json({
            success: true,
            intentId: result.intentId,
            expiresInSeconds: result.expiresInSeconds,
            retryAfterSeconds: result.retryAfterSeconds,
          });
          return;
        case 'invalid_email': sendError(response, 400, 'EMAIL_VERIFICATION_INVALID_EMAIL'); return;
        case 'rate_limited': sendError(response, 429, 'EMAIL_VERIFICATION_RATE_LIMITED', result.retryAfterSeconds); return;
        case 'cooldown': sendError(response, 429, 'EMAIL_VERIFICATION_RESEND_COOLDOWN', result.retryAfterSeconds); return;
        case 'send_limit': sendError(response, 429, 'EMAIL_VERIFICATION_SEND_LIMIT'); return;
        case 'expired': sendError(response, 410, 'EMAIL_VERIFICATION_EXPIRED'); return;
        case 'not_found': sendError(response, 404, 'EMAIL_VERIFICATION_NOT_FOUND'); return;
        case 'delivery_failed': sendError(response, 503, 'EMAIL_VERIFICATION_DELIVERY_UNAVAILABLE'); return;
      }
    } catch {
      sendError(response, 503, 'EMAIL_VERIFICATION_UNAVAILABLE');
    }
  });

  router.post('/email-verification/verify', async (request, response) => {
    if (!enabled || !service) {
      sendError(response, 404, 'EMAIL_VERIFICATION_DISABLED');
      return;
    }
    const body: unknown = request.body;
    if (!isRecord(body) || !hasOnlyKeys(body, ['intentId', 'email', 'code']) ||
      typeof body.intentId !== 'string' || !INTENT_ID.test(body.intentId) ||
      typeof body.email !== 'string' || body.email.length > 320 ||
      typeof body.code !== 'string' || body.code.length > 32) {
      sendError(response, 400, 'EMAIL_VERIFICATION_INVALID_REQUEST');
      return;
    }
    try {
      const result = await service.verifyCode({
        intentId: body.intentId,
        email: body.email,
        code: body.code,
        ipAddress: ipAddress(request),
      });
      switch (result.status) {
        case 'verified':
          response.setHeader('Cache-Control', 'no-store');
          response.json({
            success: true,
            verificationToken: result.verificationToken,
            expiresInSeconds: result.expiresInSeconds,
          });
          return;
        case 'invalid_email': sendError(response, 400, 'EMAIL_VERIFICATION_INVALID_EMAIL'); return;
        case 'rate_limited': sendError(response, 429, 'EMAIL_VERIFICATION_RATE_LIMITED', result.retryAfterSeconds); return;
        case 'invalid': sendError(response, 400, 'EMAIL_VERIFICATION_INVALID_CODE'); return;
        case 'attempts_exhausted': sendError(response, 429, 'EMAIL_VERIFICATION_ATTEMPTS_EXHAUSTED'); return;
        case 'expired': sendError(response, 410, 'EMAIL_VERIFICATION_EXPIRED'); return;
        case 'already_verified': sendError(response, 409, 'EMAIL_VERIFICATION_ALREADY_USED'); return;
        case 'not_found': sendError(response, 404, 'EMAIL_VERIFICATION_NOT_FOUND'); return;
      }
    } catch {
      sendError(response, 503, 'EMAIL_VERIFICATION_UNAVAILABLE');
    }
  });

  return router;
}
