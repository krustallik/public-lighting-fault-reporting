import express, { type Express } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createRuntimeConfig } from './config/index.js';
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
import { createProxyTrustPredicate, parseTrustedProxyCidrs } from './security/clientAddress.js';
import { addressIpLimiter } from './security/addressIpLimiter.js';
import { kosiceServiceAreaClassifier } from './domain/serviceArea.js';
import { createAdminCsrfGuard, createHostBoundary } from './middleware/productionRequestBoundary.js';

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
  const runtimeConfig = createRuntimeConfig(env);
  const app = express();
  const trustedProxyCidrs = parseTrustedProxyCidrs(runtimeConfig.trustProxyCidrs.join(','));
  app.set('trust proxy', trustedProxyCidrs.length > 0
    ? createProxyTrustPredicate(trustedProxyCidrs)
    : false);

  if (runtimeConfig.nodeEnv !== 'production') {
    app.use(cors({ origin: runtimeConfig.corsOrigin, credentials: true }));
  }
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api', (_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', createHostBoundary(runtimeConfig, 'either'));

  app.use('/api', healthRoutes);
  const publicHost = createHostBoundary(runtimeConfig, 'public');
  const adminHost = createHostBoundary(runtimeConfig, 'admin');
  const addressSuggestionService = options.reportAddressSuggestionService ?? reportAddressSuggestionService;
  app.use(
    '/api/reports',
    publicHost,
    createReportAddressSuggestionRouter(
      addressSuggestionService,
      options.addressIpLimiter ?? addressIpLimiter,
      options.serviceAreaClassifier ?? kosiceServiceAreaClassifier
    )
  );
  app.use('/api/light-points', publicHost, lightPointsRoutes);
  mountLocalTestSubmitRoutes(app, env);
  app.use('/api/admin', adminHost, createAdminCsrfGuard(runtimeConfig), adminRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
