# P0 Baseline and P2 Read-Only Research Checkpoint

**Status:** factual checkpoint draft, ready for independent audit
**Evidence date:** 2026-10-03
**Scope:** read-only repository characterization and anonymous, GET/HEAD-only inspection of the public AUSEMIO form. This note records current behavior; it does not accept new product decisions.

Canonical detail for external form evidence is [AUSEMIO contract audit](../ausemio/contract-audit.md). The [Development & Research Plan](../development-research-plan.md) remains the source for phase sequencing and accepted process requirements.

## 1. Summary of observed state

- The repository contains a React/Vite public UI and admin UI in the **same frontend application and build** (`frontend/src/App.tsx`, `frontend/package.json`). Admin separation is a plan requirement; it is not implemented in the current app.
- The backend is an Express/TypeScript API with PostgreSQL persistence (`backend/src/index.ts`, `backend/src/db/pool.ts`). Inventory, admin/session, import-batch, and technical-log data are persisted; public report submissions are currently **simulated**.
- `backend/src/services/aussemio.service.ts::sendReportToExternalSystem` does not send a request to AUSEMIO. It returns a synthetic `RPT-<timestamp>` reference and attempts to store a sanitized technical integration log. There is no local report table in `database/schema.sql`.
- Admin capability currently includes login/session endpoints, inventory CRUD, CSV/JSON/GeoJSON import/export, settings/log views, and geocoding-related inventory behavior. Admin route protection is applied in the API router (`backend/src/routes/admin.routes.ts`).
- No automated test/spec files, test scripts, lint scripts, or checked-in CI workflow were found in the inspected repository inventory. Package build scripts exist.
- AUSEMIO public client construction and public field metadata were inspected without submitting or entering data. The resulting evidence and limits are in the canonical audit note.

## 2. Repository evidence and current behavior

### Product and frontend

- Route composition in `frontend/src/App.tsx` exposes `/map`, `/report`, `/result`, and admin login/dashboard/inventory/import/settings/log pages. The public and admin routes are in one `Routes` tree and share the frontend build.
- Public reporting is a two-step form. `frontend/src/schemas/reportSchema.ts` defines required location/email/consent and optional phone, optional location/fault detail, and a five-file maximum via `frontend/src/config/ausemioForm.ts`. `frontend/src/utils/buildReportFormData.ts::buildReportFormData` creates multipart form data using local AUSEMIO-shaped keys.
- `frontend/src/pages/MapPage/MapPage.tsx` and `frontend/src/components/LightPointsMap/` implement the map and marker interactions. `frontend/src/services/lightPointsApi.ts` retrieves inventory through the backend API.
- `frontend/src/context/AdminAuthContext.tsx`, `frontend/src/services/adminApi.ts`, and `frontend/src/components/AdminProtectedRoute/AdminProtectedRoute.tsx` implement frontend admin session awareness and route navigation protection. The route guard is not the API authorization boundary.

### Backend/API

- `backend/src/index.ts` configures CORS with credentials, cookie parsing, JSON parsing, routes, not-found/error handlers, checks PostgreSQL connectivity, runs migrations, and optionally starts automatic geocoding.
- `backend/src/routes/` defines public health, geocoding, inventory, reporting, and admin API routes. `backend/src/controllers/` adapts Express requests to service calls; `backend/src/services/` contains business and persistence operations.
- `backend/src/routes/admin.routes.ts` mounts `/auth` without the general admin middleware, then applies `requireAdmin` before `/street-lights`, `/logs`, and `/integration` routes.
- Reporting route `POST /api/reports/send` runs upload middleware and delegates to `backend/src/services/reports.service.ts::sendFaultReport`. It parses/validates fields, can replace a submitted location with the address of the selected inventory point, appends an interactive-map detail suffix, builds debug metadata, then calls the simulator. The response status is `simulated`.
- Report upload middleware (`backend/src/middleware/reportUpload.ts`) stores files in memory and limits count to 5 and size to 10 MiB per file. The current service does not forward the file bytes to AUSEMIO.
- Inventory CRUD is in `backend/src/services/lightPoints.service.ts`; admin filtering/pagination in `backend/src/services/adminStreetLights.service.ts`; import/export in `streetLightsImport.service.ts` and `streetLightsExport.service.ts`.

### PostgreSQL and persistence

- Bootstrap schema and seed are `database/schema.sql` and `database/seed.sql`; Compose mounts them for initial PostgreSQL container setup (`docker-compose.yml`). Schema tables are `light_points`, `admins`, `integration_logs`, `admin_refresh_sessions`, `import_batches`, and `admin_activity_logs`.
- Important constraints/defaults include unique `admins.username`; `light_points.status` default `active` and CHECK values `active`, `inactive`, `maintenance`; `TIMESTAMPTZ` creation/update/session fields; refresh-session FK cascade on admin deletion; import/admin log admin FKs set null on deletion; `integration_logs.status` default `pending`; and `gen_random_uuid()` for refresh session IDs.
- Runtime migration code is `backend/src/db/migrate.ts::runMigrations`. It applies an inline idempotent `address_geocoded_at` column addition, then executes sorted `.sql` files from `backend/src/db/migrations/` at backend startup. `database/migrations/` also contains numbered SQL files, including a `003_admin_auth_and_batches.sql` with a counterpart under the runtime directory. The canonical owner of both migration locations and the upgrade/rollback policy are unresolved; no migration ledger is visible in `runMigrations`.
- Persistence access is primarily through parameterized `pg` queries in backend services, using `backend/src/db/pool.ts`. There is no ORM.
- Report field values are handled in request memory. The only report-related persistence currently visible is sanitized technical metadata written to `integration_logs`; failure to write that log is caught and does not fail the simulated result. No durable report payload or local report lifecycle is present in the schema/code inspected.

### Import, export, geocoding, and logging

- Import supports CSV, JSON, and GeoJSON parsing in `backend/src/services/streetLightsImport.service.ts::parseImportBuffer`. Previews live in a process-local `Map`, are associated with an admin, and expire after 15 minutes (`PREVIEW_TTL_MS`). Confirm rechecks existing `external_id` values and sequentially creates/updates/skips rows; per-row exceptions increment failure count, then a batch record and admin activity record are written. This is observed behavior, not an accepted import policy.
- Export format handling is in `backend/src/services/streetLightsExport.service.ts::exportStreetLights`; API dispatch is `backend/src/controllers/adminStreetLights.controller.ts::exportFile`. Supported requested formats include CSV, JSON, and GeoJSON.
- Reverse geocoding uses public Nominatim HTTP requests in `backend/src/services/geocoding.service.ts`. A process-local coordinate cache and minimum interval are used; configuration is under `backend/src/config/index.ts`. Automatic geocoding is opt-in through `NOMINATIM_AUTO_GEOCODE`; a manual script is `backend/src/scripts/geocodeLightPoints.ts`.
- Admin activity log writes are in `backend/src/services/adminActivity.service.ts`; integration simulation writes are in `backend/src/services/aussemio.service.ts`. The integration-log listing controller selects technical fields rather than request/response JSON payloads (`backend/src/controllers/adminLogs.controller.ts`).

## 3. Current authentication/session evidence

- Authentication is admin-only; public map/report routes do not require an admin session in the route definitions inspected.
- Login, refresh, logout, and current-user routes are in `backend/src/routes/adminAuth.routes.ts`; login is protected by `backend/src/middleware/loginRateLimit.ts` (20 attempts per 15 minutes as configured there).
- `backend/src/services/auth.service.ts` uses bcrypt password comparison, JWT access tokens with one-hour expiry, and refresh JWTs with 30-day expiry. `admin_refresh_sessions.token_hash` stores the SHA-256 hash of the **full refresh JWT**; the refresh JWT's `jti` is stored as the session row's `id`. Refresh sessions are rotated on refresh and revocable on logout.
- Cookie flags are `httpOnly`, `SameSite=Lax`, path `/`, and `Secure` only when `NODE_ENV=production` (`backend/src/utils/cookies.ts`, `backend/src/config/auth.ts`). The API `requireAdmin` middleware verifies/loads admin state (`backend/src/middleware/requireAdmin.ts`). The frontend route guard alone does not protect backend data.
- The visible admin model has `is_active` and no role/permission distinction (`database/schema.sql`, `backend/src/services/auth.service.ts`). Account provisioning, password reset, and a multi-role policy are not determined by this repository.

## 4. CI, tests, and supplied quality baseline

- The two npm packages are independent and each has a lockfile. There is no root package manifest/workspace in the inspected file inventory.
- Frontend scripts: `dev`, `build` (`tsc -b && vite build`), `preview` (`frontend/package.json`). Backend scripts: `build` (`tsc`), `start`, `dev` (`tsx watch`), `geocode:points` (`backend/package.json`). Neither manifest defines test or lint scripts.
- The inspected repository inventory has no automated test/spec source files and no checked-in CI workflow. `.sqlfluff` exists, but SQL lint was not run during this checkpoint. `README.md` contains a manual checklist; it is not an automated suite.
- The prior supplied audit baseline recorded in `docs/research/development-research-plan.md` reports frontend `npm audit`: 8 findings (4 high, 4 moderate); backend: 6 (2 high, 3 moderate, 1 low); SQLFluff: 112 mostly style findings; Codex Security deep scan: no final report. These numbers were **not reproduced or independently verified in this checkpoint**; raw reports were not present among the inspected source files. This is provenance-limited prior evidence, not a current scan result.
- CI provider is **OWNER/INFRASTRUCTURE DECISION REQUIRED** unless hosting/settings supply unambiguous evidence. No provider selection is made here.

## 5. Configuration/runtime inventory

Variable names and defaults are defined in `.env.example`, `backend/src/config/index.ts`, `backend/src/config/auth.ts`, `frontend/src/config/adminRoutes.ts`, `frontend/vite.config.ts`, and Compose files. No secret values were read or copied.

- Database: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`.
- Backend: `NODE_ENV`, `BACKEND_PORT` in the example (Compose passes `PORT`), `CORS_ORIGIN`, `JWT_SECRET`, `ADMIN_INITIAL_PASSWORD`.
- Frontend build/runtime: `FRONTEND_PORT`, `VITE_API_URL`, `VITE_ADMIN_BASE_PATH`.
- AUSEMIO configuration placeholders: `AUSEMIO_BASE_URL`, `AUSEMIO_API_KEY`, `AUSEMIO_TEST_MODE`, `AUSEMIO_LOCALE`. Current report sending remains simulated regardless of these settings in the inspected service.
- Nominatim: `NOMINATIM_AUTO_GEOCODE`, `NOMINATIM_BASE_URL`, `NOMINATIM_USER_AGENT`, `NOMINATIM_ACCEPT_LANGUAGE`, `NOMINATIM_MIN_INTERVAL_MS`.
- Compose starts PostgreSQL 16, backend, and frontend (`docker-compose.yml`); `docker-compose.dev.yml` adds source synchronization/hot reload behavior. Direct host setup additionally needs Node/npm compatible with the package lockfiles and a reachable PostgreSQL instance. Exact tested runtime versions are not established by the files inspected.

## 6. Confirmed mismatches and open decisions

### Confirmed local-vs-public contract drift

The canonical external detail is in [contract-audit.md](../ausemio/contract-audit.md). At a glance, local form/backend codes differ from the public form's current settings: local service supports VO code `2` only; local location blocks are `Q8/Q9/Q10` while public settings show `Q10/Q11/Q12`; local fault codes/labels in `frontend/src/config/ausemioForm.ts` and `backend/src/config/ausemioFormOptions.ts` do not match the public service-2 option set. Local UI/backend allow phone to be omitted, while public settings mark the telephone assignment required. No mapping/behavior change is made in this checkpoint.

### Owner/infra decisions still open

- CI provider and required-check enforcement, if repository hosting/settings do not resolve it.
- Import semantics: partial success vs atomic, duplicate identity, retry/idempotency, concurrency, and audit-log semantics. Until decided, only research/current-state characterization/alternatives are allowed for dependent criteria, tests, or implementation.
- Migration source-of-truth, schema version/replay/rollback policy, and database deployment responsibilities.
- Production host/base domain and API topology; domain/TLS/hosting details for the already-accepted separate admin application and `admin.<domain>` origin.
- AUSEMIO live-send/report acceptance semantics, safe non-production endpoint availability, and any separately scoped permission for a production write. No permission is presumed.
- Export contract, settings source of truth, PostGIS decision, admin role/account lifecycle, retention, and accessibility/privacy decisions as catalogued in `development-research-plan.md`.

## 7. Traceability for this checkpoint

| Requirement / acceptance criterion | Test(s) | Implementation / result | Validation evidence | Independent audit outcome | Thesis-evidence reference |
|---|---|---|---|---|---|
| Record current frontend/admin architecture from code | Not applicable: research-only checkpoint | Same Vite app/router currently includes public and admin routes | `frontend/src/App.tsx`, `frontend/package.json` | Pending | Not transferred; verified repository fact only |
| Record API, persistence, simulated report, auth, import/export/geocoding/logging behavior | Not applicable: research-only checkpoint | Evidence summarized in sections 2–3 | Paths and symbols cited in this checkpoint | Pending | Not transferred |
| Record existing test/CI and supplied quality baseline without overstating it | No test/build/security/lint commands run | No tests/scripts/workflow found; prior counts explicitly marked unverified here | `frontend/package.json`, `backend/package.json`, repository file inventory, prior-plan note | Pending | Not transferred |
| Inspect AUSEMIO public contract without unsafe requests | Browser request interception is the safety validation, not an application test | Read-only observations and limits in canonical contract note | [contract-audit.md](../ausemio/contract-audit.md), evidence table and network-safety ledger | Pending | Not transferred |

## 8. Limitations

- This is source characterization plus public-client inspection, not a build/test/security audit. No application tests, migrations, database writes, or npm/SQL security scans were run for this checkpoint.
- Current runtime configuration/deployment state beyond repository files is **not determined from the repository**.
- The public AUSEMIO frontend evidence does not establish what its server accepts or returns for a write. Those production-only facts remain unknown and require a safe official test endpoint or, if a production write is proposed, separate explicit owner approval. See the canonical contract audit.
- All baseline statements are limited to the paths and public evidence cited here; planned requirements in `development-research-plan.md` are not described as implemented behavior.
