# Public lighting fault reporting

Thesis/pre-production web application for locating public-lighting inventory points and preparing a VO fault report. Public users select a known light point or a manual location and fill an editable report form. The current report result is local/simulated: there is no active production send endpoint, no citizen-report persistence, and no AUSEMIO traffic. Admin users manage inventory and its import/export/audit history.

## Technology and layout

| Area | Main technology |
|---|---|
| Public/admin browser apps | React 18, TypeScript, Vite, React Router, Leaflet, React Hook Form, Zod |
| API | Node.js 20, TypeScript ESM/NodeNext, Express |
| Persistence | PostgreSQL 16 + PostGIS; explicit checksummed SQL migrations via `backend/src/db/migrations/` |
| Tests | Vitest, Testing Library, Playwright, disposable PostgreSQL/PostGIS integration tests |
| Development | Docker Compose, npm, TypeScript, GitHub Actions |
| Production foundation | Separate public/admin static builds, Nginx, private API/database networks; see [production foundation notes](docs/deployment/production-foundation.md) |

```text
frontend/apps/public/        public map, report flow, public API clients
frontend/apps/admin/         independent admin app, login, inventory/import/export/logs
frontend/shared/             small shared app contracts
backend/src/routes/          HTTP route boundaries
backend/src/controllers/     request/response controllers
backend/src/services/        inventory, auth, import/export, geocoding and report logic
backend/src/db/              Postgres pool, controlled migration logic and migration SQL
backend/src/middleware/      auth, upload, request-origin and error middleware
database/production/         DBA role/grant scripts
scripts/production/          synthetic production Nginx/topology smoke checks
docs/research/checkpoints/   canonical planning and implementation evidence
```

## Local development with Docker

Requires Docker Desktop or Docker Engine with Docker Compose v2.22+.

1. Copy `.env.example` to `.env`; keep the local development values local.
2. Start the development-only stack:

   ```sh
   docker compose up --build
   ```

The root `docker-compose.yml` is **development only**. It publishes Postgres `5432`, Express `5000`, public Vite `5173`, and admin Vite `5174` on the host. Its one-shot `migrations` service applies the canonical migrations before the API starts. It is not the production topology.

| Service | Local URL |
|---|---|
| Public Vite app | <http://localhost:5173/map> |
| Admin Vite app | <http://localhost:5174/panel-svietidla/login> |
| Development API | <http://localhost:5000/api/health> |
| Development PostgreSQL | `localhost:5432` |

To load the synthetic development seed, set a unique local `ADMIN_INITIAL_PASSWORD` in `.env`, then run the explicit guarded command:

```sh
docker compose run --rm -e ALLOW_DESTRUCTIVE_SEED=true backend npm run seed:dev
```

The seed refuses database names that do not end in `_dev` or `_test`. There is no default admin password. Do not use this seed command or any development credential in production.

For hot reload with Compose Watch:

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml build
docker compose -f docker-compose.yml -f docker-compose.dev.yml watch
```

## Local development without Docker

Install Node.js 20 and run PostgreSQL 16 with PostGIS 3.5. Use a disposable development DB. In PowerShell, configure the backend environment for that DB, install dependencies, then run the controlled developer migration and API:

```powershell
cd backend
npm ci
$env:NODE_ENV = "development"
$env:DB_HOST = "127.0.0.1"
$env:DB_PORT = "5432"
$env:DB_NAME = "lighting_faults_dev"
$env:DB_USER = "postgres"
$env:DB_PASSWORD = "postgres"
npm run db:migrate
npm run dev
```

In a second terminal, install frontend dependencies and start either or both Vite applications:

```powershell
cd frontend
npm ci
$env:VITE_API_URL = "/api"
$env:VITE_DEV_PROXY_TARGET = "http://127.0.0.1:5000"
npm run dev:public
```

```powershell
cd frontend
$env:VITE_API_URL = "/api"
$env:VITE_DEV_PROXY_TARGET = "http://127.0.0.1:5000"
$env:VITE_ADMIN_BASE_PATH = "/panel-svietidla"
npm run dev:admin
```

Migrations run through `npm run db:migrate`; the normal HTTP process only checks that the migration ledger matches the packaged chain. No production credentials are needed for local work.

## Current API surface

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Database-backed health check |
| GET | `/api/light-points` | Public inventory points for the map |
| GET | `/api/light-points/:id` | Public inventory point details |
| POST | `/api/reports/address-suggestion` | Optional Geoapify public/report address suggestion; disabled unless configured |
| POST | `/api/dev/ausemio-test-submit` | Metadata-only local test sink; mounted only in development/test with explicit `LOCAL_TEST_SUBMIT_ENABLED=true` |
| `/api/admin/*` | Admin auth and protected inventory/import/export/log APIs; see `backend/src/routes/admin.routes.ts` and `adminAuth.routes.ts` |

There is no `/api/reports/send` production route, no live AUSEMIO adapter, and no production local-test submission endpoint. A local simulated result is not evidence that a municipality received or accepted a report. Current product scope is AUSEMIO service `2` / VO only; service `16` / CSS remains out of scope.

## Tests and builds

Frontend:

```powershell
cd frontend
npm ci
npm run typecheck
npm test
$env:VITE_API_URL = "/api"
$env:VITE_MAP_TILE_PROVIDER = "carto"
$env:VITE_CARTO_TILES_APPROVED = "true"
$env:VITE_CARTO_PUBLIC_KEY = "synthetic-build-key"
npm run build
```

The synthetic key is only a build fixture; no map request is made by the build. Production public builds fail without approved CARTO configuration. The dual-app build strips CARTO configuration from the admin build. Browser E2E requires the repository's proven process-egress isolation and a disposable PostGIS database; do not run it outside that containment.

Backend:

```powershell
cd backend
npm ci
npm run typecheck:tests
npm test
npm run build
```

PostgreSQL/PostGIS integration tests use explicit opt-in environment flags and a disposable database/cluster. `PRODUCTION_FOUNDATION_POSTGRES=true` additionally exercises the database roles and first-admin bootstrap against a disposable DB whose configured name ends in `_test`; its test cluster connection needs permission to create/drop temporary roles and databases. Never point destructive test flags at real data.

CI preserves the six jobs `frontend`, `backend`, `process-egress-research`, `browser-e2e`, `dependency-audit-report`, and `sqlfluff-report`. Frontend/backend jobs require production runtime dependency audit, builds and tests; browser/provider-facing paths run under process-egress containment. Dependency and SQLFluff report jobs are informational: a green report job does not mean zero findings. On Windows, the existing locality artifact generator can remain line-ending/hash sensitive; Linux CI is the authoritative check for that documented portability limitation.

## Production foundation

Production deployment settings and role/bootstrap operations are documented in [docs/deployment/production-foundation.md](docs/deployment/production-foundation.md). Production uses `docker-compose.production.yml`: independently built public/admin static images and origins, Nginx-only host ingress, a private Express service, private Postgres/PostGIS, and distinct runtime/migration/bootstrap DB capabilities. It does not run Vite in production.

This repository foundation does not provision DNS/TLS, perform CD, run backups/restores or retention cleanup, prove RPO/RTO, or benchmark the target Ubuntu host. Do not treat it as production-ready until those later operations/resource, external provider-account and privacy/legal gates are independently closed.

## AUSEMIO and external-service boundary

AUSEMIO is ON HOLD. Never submit the real public form for development/testing, do not send POST/PUT/PATCH/DELETE traffic to the production AUSEMIO form, and do not use real personal information. CARTO production tiles and Geoapify public address suggestion are configured in the production foundation, but no live keys or provider traffic are used by tests or this repository change. Inventory geocoding through the legacy Nominatim path remains disabled in production.
