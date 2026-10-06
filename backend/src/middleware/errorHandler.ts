import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/AppError.js';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const isInvalidJsonBody = Boolean(
    err && typeof err === 'object' && 'type' in err && err.type === 'entity.parse.failed'
  );
  if (!(err instanceof AppError && err.status < 500) && !isInvalidJsonBody) {
    // Request bodies and provider failures can contain precise locations or identifiers.
    // Keep process logs useful without serializing error objects, messages, or stacks.
    console.error('Unhandled API error');
  }

  const status = err instanceof AppError ? err.status : isInvalidJsonBody ? 400 : 500;
  const message = isInvalidJsonBody
    ? 'Invalid request body'
    : status >= 500
      ? 'Internal server error'
      : err instanceof Error ? err.message : 'Internal server error';

  res.status(status).json({
    success: false,
    message,
  });
}
