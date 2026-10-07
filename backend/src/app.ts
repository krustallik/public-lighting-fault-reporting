import express, { type Express } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import healthRoutes from './routes/health.routes.js';
import lightPointsRoutes from './routes/lightPoints.routes.js';
import adminRoutes from './routes/admin.routes.js';
import { createReportAddressSuggestionRouter } from './routes/reportAddressSuggestion.routes.js';
import {
  reportAddressSuggestionService,
  type ReportAddressSuggestionService,
} from './services/reportAddressSuggestion.service.js';
import { mountLocalTestSubmitRoutes } from './routes/ausemioTest.routes.js';
import { parseTrustedProxyCidrs, createProxyTrustPredicate } from './security/clientAddress.js';
import { addressIpLimiter } from './security/addressIpLimiter.js';
import { kosiceServiceAreaClassifier } from './domain/serviceArea.js';

export interface AppOptions {
  /** Test seam for fake transport; the production default intentionally has no provider. */
  reportAddressSuggestionService?: ReportAddressSuggestionService;
  addressIpLimiter?: Pick<typeof addressIpLimiter, 'consume'>;
  serviceAreaClassifier?: typeof kosiceServiceAreaClassifier;
}

/** Build the active API surface without starting database or background services. */
export function createApp(
  env: Record<string, string | undefined> = process.env,
  options: AppOptions = {}
): Express {
  const app = express();
  const trustedProxyCidrs = parseTrustedProxyCidrs(env.TRUST_PROXY_CIDRS);
  app.set('trust proxy', trustedProxyCidrs.length > 0
    ? createProxyTrustPredicate(trustedProxyCidrs)
    : false);

  app.use(
    cors({
      origin: config.corsOrigin,
      credentials: true,
    })
  );
  app.use(cookieParser());
  app.use(express.json());

  app.use('/api', healthRoutes);
  const addressSuggestionService = env.NODE_ENV === 'production'
    ? reportAddressSuggestionService
    : options.reportAddressSuggestionService ?? reportAddressSuggestionService;
  app.use(
    '/api/reports',
    createReportAddressSuggestionRouter(
      addressSuggestionService,
      options.addressIpLimiter ?? addressIpLimiter,
      options.serviceAreaClassifier ?? kosiceServiceAreaClassifier
    )
  );
  app.use('/api/light-points', lightPointsRoutes);
  mountLocalTestSubmitRoutes(app, env);
  app.use('/api/admin', adminRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
