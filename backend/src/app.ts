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
import { addressIpLimiter, reportTargetValidationIpLimiter } from './security/addressIpLimiter.js';
import { kosiceServiceAreaClassifier } from './domain/serviceArea.js';
import type { LightPointCoordinateRepository } from './domain/reportTarget.js';
import type { LightPointAddressRepository } from './services/lightPointAddressRepository.js';
import { createAdminCsrfGuard, createHostBoundary } from './middleware/productionRequestBoundary.js';
import { pool } from './db/pool.js';
import { createEmailVerificationRouter } from './routes/emailVerification.routes.js';
import { EmailVerificationCrypto } from './services/emailVerificationCrypto.js';
import type { EmailVerificationProvider } from './services/emailVerificationProvider.js';
import { ResendEmailVerificationProvider } from './services/emailVerificationProvider.js';
import { EmailVerificationService } from './services/emailVerification.service.js';
import type { EmailVerificationStore } from './services/emailVerificationStore.js';
import { PostgresEmailVerificationStore } from './services/emailVerificationStore.js';
import { PostgresFaultHistoryStore, type FaultHistoryStore } from './services/faultReportHistory.service.js';

export interface AppOptions {
  /** Test seam for fake transport; the production default intentionally has no provider. */
  reportAddressSuggestionService?: ReportAddressSuggestionService;
  addressIpLimiter?: Pick<typeof addressIpLimiter, 'consume'>;
  reportTargetValidationIpLimiter?: Pick<typeof reportTargetValidationIpLimiter, 'consume'>;
  serviceAreaClassifier?: typeof kosiceServiceAreaClassifier;
  /** Test seam for selected-inventory-point address lookup. */
  reportTargetCoordinateRepository?: LightPointCoordinateRepository;
  /** Test seam for selected-inventory-point address persistence. */
  reportTargetAddressRepository?: LightPointAddressRepository;
  /** Test-only seam. Production uses the configured Resend adapter. */
  emailVerificationProvider?: EmailVerificationProvider;
  /** Test seam for isolated persistence tests. Production uses the runtime PostgreSQL pool. */
  emailVerificationStore?: EmailVerificationStore;
  /** Test seam for local metadata-only report history. */
  faultHistoryStore?: FaultHistoryStore;
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
      options.serviceAreaClassifier ?? kosiceServiceAreaClassifier,
      options.reportTargetCoordinateRepository,
      options.reportTargetAddressRepository,
      runtimeConfig.jwtSecret,
      options.reportTargetValidationIpLimiter ?? reportTargetValidationIpLimiter
    )
  );
  const emailVerificationEnabled = runtimeConfig.emailVerification.enabled;
  const faultHistoryStore = options.faultHistoryStore ?? new PostgresFaultHistoryStore(
    pool,
    options.serviceAreaClassifier ?? kosiceServiceAreaClassifier,
    runtimeConfig.jwtSecret
  );
  const emailVerificationService = emailVerificationEnabled
    ? new EmailVerificationService(
      options.emailVerificationStore ?? new PostgresEmailVerificationStore(pool),
      options.emailVerificationProvider ?? new ResendEmailVerificationProvider(
        runtimeConfig.emailVerification.resendApiKey,
        runtimeConfig.emailVerification.resendFromEmail
      ),
      new EmailVerificationCrypto(runtimeConfig.jwtSecret)
    )
    : undefined;
  app.use(
    '/api/reports',
    publicHost,
    createEmailVerificationRouter(emailVerificationEnabled, emailVerificationService)
  );
  app.use('/api/light-points', publicHost, lightPointsRoutes);
  mountLocalTestSubmitRoutes(app, env, emailVerificationService, faultHistoryStore);
  app.use('/api/admin', adminHost, createAdminCsrfGuard(runtimeConfig), adminRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
