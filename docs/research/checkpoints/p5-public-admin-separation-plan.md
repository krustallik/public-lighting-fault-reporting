# P5 — Public/Admin Frontend Separation Plan

**Status:** targeted correction draft — ready for targeted independent re-audit. Implementation and deployment are not authorized by this document.
**Baseline:** `master` at `6be892f8ef6e9fc2a527b67f6a0c932df942310e` (P3 merge).
**Scope:** separate public and admin frontend applications/build artifacts in the same GitHub repository; retain the Express API and PostgreSQL/PostGIS persistence unless an approved topology requires a narrow technical change.

## 1. Decision summary

The binding owner decisions are that public and admin become separate frontend applications/builds and remain in the same GitHub repository. Each application needs its own source/entry/router/build artifact, and the built import graphs must be separated. The existing backend remains the single API and persistence service. P3 database/import/export behavior is preserved.

Separate hostnames/origins, the proposed admin hostname, independent deploy units or cadence, rollback/version-skew policy, and reverse-proxy topology are not binding decisions. They remain deployment/infrastructure choices. The topology-neutral source/build split may proceed after this plan is approved without waiting for those choices.

Recommended code layout:

```text
frontend/
  apps/
    public/                 # public map, report form, result UI
    admin/                  # login, inventory, imports, settings, logs
  shared/                   # only frontend contracts genuinely used by both apps
  package.json              # shared dependency installation and explicit app scripts
  package-lock.json
```

Keep the current frontend dependency installation and lockfile initially. Do not introduce npm workspaces or a separately versioned shared package unless implementation evidence shows they are needed. A small shared contract module may contain only symbols demonstrated by active imports in both applications. Current evidence supports `LightPointStatus` as shared. Keep the `LightPoint` API/domain model, runtime mapping, coordinate helpers, and status labels app-owned unless implementation import analysis proves a specific symbol is consumed by both apps.

One possible deployment is two static origins, with the admin app on a distinct `admin.<domain>` host, and the same backend reachable as a same-origin `/api` reverse-proxy path from each app origin. This is a recommendation, not an accepted origin requirement. The reverse-proxy capability has not been established by repository configuration, and the backend's handling of `Origin` through such a proxy must be verified. Other topologies, including one browser origin serving two independent app builds under separate paths, remain valid unless the owner later requires distinct origins.

Owner-provided deployment context:

- Existing public host: `mapa.vra-ubuntu-server-0579.virtual.cloud.tuke.sk`.
- Proposed admin host: `admin.mapa.vra-ubuntu-server-0579.virtual.cloud.tuke.sk` is a recommendation only; it is not yet a binding hostname decision.
- The system is pre-production and the P3 implementation is merged. These are owner-provided/current-checkpoint facts, not a live-host or runtime database inspection.
- P4/AUSEMIO production integration remains on hold. This plan authorizes no AUSEMIO, tile-provider, or geocoder traffic and no DNS or deployment change.

## 2. Current repository architecture (verified from source)

### 2.1 Frontend entry, router, and active screens

There is one Vite application rooted at `frontend/`. `frontend/index.html` loads `frontend/src/main.tsx`; `main.tsx` mounts one React root, one `BrowserRouter`, and the `AdminAuthProvider`. `frontend/src/App.tsx` statically imports and routes both public and admin pages.

| Current route/screen | Source | Active responsibility |
|---|---|---|
| `/` → `/map`, `/map` | `frontend/src/App.tsx`, `frontend/src/pages/MapPage/MapPage.tsx`, `frontend/src/components/LightPointsMap/` | Public map, known inventory points, device/custom targets, confirmation flow |
| `/report`, `/result` | `frontend/src/pages/ReportFormPage/`, `frontend/src/pages/ResultPage/` | Public form, local/simulated result semantics |
| `/panel-svietidla/login` | `frontend/src/pages/AdminLoginPage/`, `frontend/src/config/adminRoutes.ts` | Admin login at the current path inside the shared application |
| `/panel-svietidla` and nested paths | `frontend/src/App.tsx`, `frontend/src/pages/Admin*`, `frontend/src/components/AdminLayout/` | Admin dashboard, inventory list/detail/create/edit, import, integration settings, and logs |

The current admin path is configured by `VITE_ADMIN_BASE_PATH` (default `/panel-svietidla`). `/admin/*` currently redirects to `/map` in `App.tsx`. The separate admin host should have its own router and may use root-based routes such as `/login`, `/street-lights`, `/import`, `/settings`, and `/logs`; retaining the old hidden path is not needed for bundle separation. Because current production-user/backward-compatibility requirements are not established in the repository, verify whether any published links require a redirect before removing the old path.

`frontend/src/main.tsx` imports Leaflet CSS and all global CSS, then initializes admin authentication for every route. `AdminAuthProvider` in `frontend/src/context/AdminAuthContext.tsx` calls `adminApi.me()` on mount. Consequently a public page currently initializes the admin session and can request `/api/admin/auth/me`; the public app should not import or initialize this provider after separation. `ReportFormLocaleProvider` is also mounted around the combined router in `App.tsx`; it belongs with the public reporting app.

The public experience is localized SK/EN through `ReportFormLocaleContext` and `frontend/src/i18n/`. The locality catalog is checked in at `frontend/src/config/data/ausemioVoLocalities.generated.ts`; retain it as static client data. Its filename does not authorize or imply production AUSEMIO integration.

`frontend/src/pages/AdminLightPointsPage/AdminLightPointsPage.tsx` is present but is not imported by the active `App.tsx` router; its own text describes CRUD as future work. Do not treat it as an active screen or migrate it into the new admin navigation without a separate usage decision.

### 2.2 Frontend service and contract boundaries

- Public services include `frontend/src/services/lightPointsApi.ts`, `geocodingApi.ts`, and `api.ts`; they use `VITE_API_URL` with a fallback of `http://localhost:5000/api`.
- Admin requests and cookie-refresh behavior are in `frontend/src/services/adminApi.ts`. It also uses `VITE_API_URL`, sets `credentials: 'include'`, and retries a protected request once after calling `/admin/auth/refresh` on a 401.
- `frontend/src/types/admin.ts` and `frontend/src/schemas/adminSchema.ts` are admin-specific. `frontend/src/types/lightPoint.ts` is referenced by both public and admin UI and is the clearest candidate for a minimal shared frontend contract.
- `frontend/src/styles/adminShared.module.css` and admin layout/components are admin-specific. Leaflet/map, reporting form, locality and report-result components are public-specific. Share no UI components unless both apps demonstrably consume the same component.

Do not make frontend TypeScript modules a backend dependency. `backend/src/types/` remains the backend's API/domain boundary; parity is maintained by tests/contracts, not by importing frontend source from the server.

### 2.3 Backend and persistence boundary

The backend is a Node 20, ESM, TypeScript/NodeNext Express application. `backend/src/index.ts` starts the API and runtime services; `backend/src/app.ts::createApp` mounts public and admin routes under `/api`. Admin routes are grouped in `backend/src/routes/admin.routes.ts`; after `/auth`, the group is protected by `requireAdmin` before street-light, logs, and integration routes are mounted.

P3 is current code on the stated master: the canonical runtime migrations are `backend/src/db/migrations/0001_initial_schema.sql` and `0002_p3_postgis_inventory.sql`; migration execution/preflight is in `backend/src/db/migrate.ts` and `migrationPreflight.ts`. Inventory persistence, import queue/history, export, and audit logic are in `backend/src/services/lightPoints.service.ts`, `streetLightsImport.service.ts`, `importQueueWorker.service.ts`, `streetLightsExport.service.ts`, and `adminActivity.service.ts`. P5 must not alter those persistence semantics or schema.

The frontend split changes which browser application calls the existing API. It does not require new API routes, database tables, migrations, or a P3 redesign.

### 2.4 Build, local runtime, CI, and browser tests

- `frontend/package.json` owns the Vite/React/TypeScript/Vitest/Playwright dependencies and scripts. Its current `build` runs `tsc -b && vite build`; no separate app builds or output paths are configured in `frontend/vite.config.ts`.
- Current Vite dev server binds port `5173`; `frontend/Dockerfile` runs the Vite development server, not a production static server.
- `docker-compose.yml` runs one frontend dev service on `5173`, the backend on `5000`, and PostGIS on `5432`. `docker-compose.dev.yml` adds bind mounts/watch for those same services.
- `backend/Dockerfile` builds and runs the API. No Nginx, production static-host configuration, reverse-proxy configuration, DNS/TLS config, or frontend deployment workflow is present in the inspected repository. Current hosting behavior is therefore **не визначено з репозиторію**.
- `.github/workflows/ci.yml` has one `frontend` job for frontend typecheck/tests/build, one `backend` job with disposable PostGIS integration/migration/smoke work, and separate informational SQLFluff/dependency report jobs. Browser E2E is a distinct `browser-e2e` job gated on `process-egress-research`.
- `frontend/tests/e2e/map-first-flow.spec.ts` and `report-form.spec.ts` cover public flows. The current `frontend/tests/e2e/` directory has no admin browser suite. Existing backend P3 integration tests are in `backend/tests/integration/`.

`frontend/playwright.config.ts` refuses to run unless `PROCESS_EGRESS_ISOLATED=1`, blocks service workers, and starts test backend/frontend processes. Preserve this containment for any new browser suite; never loosen it to enable admin tests.

## 3. Target architecture

The drawing illustrates deployment option A only. It does not require separate browser origins or per-origin proxies; application/build separation is required under every selected hosting topology.

```text
Same Git repository
┌──────────────────────┐     ┌──────────────────────┐
│ frontend/apps/public │     │ frontend/apps/admin  │
│ own entry/router     │     │ own entry/router     │
│ own Vite build       │     │ own Vite build       │
└──────────┬───────────┘     └──────────┬───────────┘
           │ same-origin /api                       │ same-origin /api
           └─────────────────┬──────────────────────┘
                             ▼
                 one existing Express API
                             ▼
                    PostgreSQL/PostGIS

frontend/shared/ contains only deliberate shared source contracts.
```

Target frontend ownership:

| Application | Owns | Must exclude |
|---|---|---|
| Public | Map-first location flow, report form, local/simulated result page, public locale state, Leaflet CSS/map components, public APIs and locality catalog | Admin pages, admin router, admin auth provider/client, admin styles, admin-only schemas/types |
| Admin | Login/session bootstrap, protected admin router/layout, inventory CRUD, import preview/confirmation/status/history, export, settings, logs, admin client/types/schemas | Public map/report pages, Leaflet dependencies/assets unless an actual admin screen needs them |
| Shared | Minimal dependency-light contracts actually imported by both; current evidence supports `LightPointStatus` | `LightPoint`, API row mapping, coordinate validation/helpers, status labels, app routing, auth, report flow, provider configuration, side-effectful API clients, duplicated business workflows unless import evidence proves shared use |

Suggested build results are independent directories such as `frontend/dist/public/` and `frontend/dist/admin/`, each containing its own `index.html` and reachable chunks/assets. The exact Vite config arrangement is an implementation choice; each app must have an explicit root and build command. Keep one root `frontend/package-lock.json` and the existing package install initially, with named scripts for public/admin typecheck, tests, and builds. A new workspace/package graph is not justified solely by the current split.

The public router keeps `/` → `/map`, `/map`, `/report`, and `/result` semantics. The admin router owns the admin app's route root, `/login`, and inventory/import/settings/log paths; the final browser path/origin depends on the selected hosting topology. Deep links must load the correct app's HTML through the selected hosting rule. The public router contains no admin fallback/redirect; the admin app must not redirect unknown routes into public map flows.

Separate entry modules should mount only their own providers. The admin app mounts `AdminAuthProvider`; the public app does not. No admin API request should be caused by public boot. Both apps may use `BrowserRouter`, but must not import each other's `App`, page modules, auth context, or router config.

## 4. API topology options

| Option | Browser behavior | Advantages | Costs / gates |
|---|---|---|---|
| **A. Distinct public/admin origins, each with a same-origin `/api` proxy — recommended candidate** | Browser calls `/api/*` on its current frontend origin; infrastructure forwards to the shared backend | Same-origin browser fetch; host-only cookies can remain scoped to the app host; one backend and DB | Requires infrastructure to route both origins' `/api` to the backend and preserve relevant headers. Backend CORS behavior must be verified through the actual proxy because the backend may still receive `Origin`. Origins and proxy are not selected. |
| **B. Shared API origin called cross-origin by both apps** | Both apps use credentialed fetch; backend returns CORS headers for the selected frontend origins | One explicit API hostname and one backend route surface | Requires an exact origin allowlist and credentialed CORS. Cookie `SameSite` behavior depends on exact origins; CSRF and cookie behavior require security review. Existing `CORS_ORIGIN` is currently one string. |
| **C. One browser origin serves both independent app builds under separate paths/hosting rules** | Two app entries/builds are routed at separate paths under one browser origin | Can preserve application/build separation without distinct hostnames | Remains a valid candidate unless the owner later requires distinct origins. Hosting rules and route precedence need verification; this option does not by itself prove CSRF safety. |
| **D. Equivalent infrastructure-supported topology** | Infrastructure serves the two independent app builds and connects each to the existing API using a documented path | Allows an equivalent solution supported by the actual environment | Must preserve app/build separation and pass the selected topology's browser, auth, cookie, CORS, CSRF, and routing evidence gates. |

Option A is a recommendation only, not an owner decision. The final topology remains undecided. Topology-neutral source/entry/router/build separation may proceed after plan approval. Decide the topology before implementing topology-specific browser/API integration. Do not silently widen cookie Domain or CORS origins, and do not add compatibility/versioning machinery just for a possible future deployment model.

## 5. Authentication, session, CORS, and security implications

Current implementation evidence:

- `backend/src/services/auth.service.ts` validates the username/password, checks `admins.is_active`, issues access and refresh JWTs, stores a hash of the refresh token in `admin_refresh_sessions`, rotates refresh tokens on refresh, and revokes sessions on refresh/logout.
- `backend/src/config/auth.ts` sets access lifetime to 1 hour and refresh lifetime to 30 days. `backend/src/utils/cookies.ts` sets `access_token` and `refresh_token` as `httpOnly`, `path: '/'`, `SameSite=Lax`; `Secure` is enabled only when `NODE_ENV=production`. No `Domain` option is set, so these are host-only cookies.
- `frontend/src/services/adminApi.ts` sends `credentials: 'include'` on requests and refresh. `AdminAuthContext` calls `/admin/auth/me` on app initialization. `/api/admin/auth/login`, `/refresh`, `/logout`, and `/me` are mounted in `backend/src/routes/adminAuth.routes.ts`.
- `backend/src/app.ts` configures CORS with one `config.corsOrigin` and `credentials: true`. `CORS_ORIGIN` defaults to `http://localhost:5173` in `backend/src/config/index.ts` and `.env.example`.
- `backend/src/routes/admin.routes.ts` leaves auth routes mounted before `requireAdmin`, then protects all admin inventory/log/integration routes. `AdminProtectedRoute` is client navigation control only; `requireAdmin` is the server authorization boundary.
- `admins` schema has identity/password/active fields but no role/permission column (`backend/src/db/migrations/0001_initial_schema.sql`). The current model is an active/inactive admin account, not a multi-role permission system.
- No explicit CSRF token or CSRF middleware was found in the inspected request path. This is an implementation/security gap. CORS alone, `SameSite=Lax` alone, and a same-origin `/api` proxy alone do not prove CSRF safety. This gate applies to every topology, including option A, and must be resolved with implementation/security evidence before topology-specific authenticated browser behavior is approved and before deployment.

Preserve existing refresh/session behavior where possible and do not add a shared parent-domain `Domain` cookie without an explicit security decision. Under topology A, the browser request is same-origin to the frontend host and the proxy forwards it to Express; Express may still receive an `Origin` header, so verify the current CORS middleware and resulting browser response through the actual proxy. The public app must not initialize admin auth.

For any selected topology, document and test unsafe authenticated admin methods. Security evidence must consider Origin/Referer validation, an explicit CSRF token strategy, exact SameSite/site semantics, host-only cookie behavior, cross-origin and cross-site form submissions, credentialed fetch behavior, and allowed/rejected request origins as applicable. Do not select a new CSRF mechanism in this planning correction; its exact solution requires implementation/security evidence. For option B, also require an exact-origin CORS allowlist, `credentials: true`, non-wildcard origin responses, and tests for allowed/rejected origins and preflight. For option A, verify proxy forwarding, backend CORS behavior, and that browser responses succeed. No auth redesign or new roles are in P5 scope unless a separate owner decision is recorded.

## 6. File/layout implementation map (planning only)

The following is the expected migration map, not a command to move files now.

| Current path/module | Planned target ownership | Notes |
|---|---|---|
| `frontend/index.html`, `frontend/src/main.tsx`, `frontend/src/App.tsx` | `frontend/apps/public/index.html` + public entry/router; add `frontend/apps/admin/index.html` + admin entry/router | Split entry and route trees. Do not wrap public app in admin auth. |
| `frontend/src/pages/MapPage/`, `ReportFormPage/`, `ResultPage/`, `frontend/src/components/LightPointsMap/`, `TargetConfirmationDialog/`, `LocalityCombobox/`, public locale/i18n, report config/utilities | `frontend/apps/public/src/` | Preserve map-first, geolocation/location activation, report form and local/simulated sink behavior. |
| `frontend/src/pages/AdminLoginPage/`, `AdminDashboardPage/`, `AdminStreetLightsPage/`, `AdminStreetLightFormPage/`, `AdminStreetLightDetailPage/`, `AdminImportPage/`, `AdminSettingsPage/`, `AdminLogsPage/`, `frontend/src/components/AdminLayout/`, `AdminProtectedRoute/` | `frontend/apps/admin/src/` | Keep P3 workflows and server-side guards intact. |
| `frontend/src/context/AdminAuthContext.tsx`, `frontend/src/services/adminApi.ts`, `frontend/src/config/adminRoutes.ts`, `frontend/src/schemas/adminSchema.ts`, `streetLightSchema.ts`, `frontend/src/types/admin.ts`, `frontend/src/styles/adminShared.module.css` | `frontend/apps/admin/src/` | Admin-only auth/API/routing/schema/style code. Decide whether to remove/replace `VITE_ADMIN_BASE_PATH` based on the selected route/hosting topology; a hostname change is not a prerequisite for source/build separation. |
| `frontend/src/types/lightPoint.ts` (only symbols actually consumed by both apps) | `frontend/shared/contracts/` | Current evidence supports `LightPointStatus` as the initial shared contract. Keep `LightPoint`, API row mapping, coordinate validation/helpers, and status labels with their owning app unless actual import evidence proves they are used by both. |
| `frontend/vite.config.ts`, `frontend/tsconfig*.json`, `frontend/vitest.config.ts`, `frontend/playwright.config.ts`, `frontend/package.json` | Frontend orchestration plus app-specific Vite/TS/test configs as evidence requires | Keep one lockfile initially. Set independent roots/output directories and aggregate scripts. Preserve the egress gate in Playwright. |
| `frontend/tests/unit/`, `frontend/tests/e2e/` | App-specific unit/component/E2E suites or explicit project configs | Keep existing public tests and add admin tests for real active workflows. Do not move tests by filename alone; align each with imports/ownership. |
| `backend/src/app.ts`, `backend/src/routes/admin.routes.ts`, `backend/src/services/`, `backend/src/db/`, `backend/src/db/migrations/`, `database/` | Remain unchanged for topology-neutral source/build separation | A selected topology may reveal a narrowly required API/CORS/proxy change that needs separate approval and evidence. No schema/migration change is planned. |
| `docker-compose.yml`, `docker-compose.dev.yml`, `.github/workflows/ci.yml` | Later implementation may add two dev app services and run both frontend builds/tests | Preserve required job names and process-egress browser containment. Do not implement DNS/TLS/prod proxy here. |

The current active route list in `App.tsx` is the authority for screens to move. Do not silently wire in the currently unreferenced `AdminLightPointsPage` or remove other legacy modules without a focused usage check.

## 7. Local development target

Use independent Vite servers, for example public `localhost:5173` and admin `localhost:5174`, with the existing backend on `localhost:5000` and PostgreSQL/PostGIS on `localhost:5432`. Each dev server owns its own `index.html`, router, Vite config, and HMR graph. The public and admin applications remain independently startable; starting one must not implicitly mount routes from the other. These ports are different browser origins but the same cookie host: host-only cookies are keyed by hostname, not port. Port separation does not prove public/admin cookie-host isolation.

Prefer a Vite `/api` dev proxy from each app to `http://localhost:5000` with app-local `VITE_API_URL=/api`. This keeps browser calls same-origin and exercises the recommended API path. If direct cross-origin requests to port `5000` are used for a test, configure an explicit test origin and do not treat that test setup as the production origin decision.

Ordinary localhost-port development does not test cookie isolation between different hosts. For that evidence, use distinct local/test hostnames mapped deterministically to loopback inside the process-egress-contained test environment, or exact approved deployment-like origins in a controlled pre-deployment environment. Do not require production DNS/TLS merely to develop the topology-neutral app/build split.

Add clear frontend scripts such as `dev:public`, `dev:admin`, `build:public`, `build:admin`, `typecheck:public`, `typecheck:admin`, and aggregate `build`, `test`, and typecheck commands. Do not duplicate `node_modules` or lockfiles without measured need. Compose may later offer `frontend-public` and `frontend-admin` dev services, while backend/PostGIS remain the current services.

## 8. Build and deployment artifact behavior

- Build public and admin as separate Vite roots with distinct output directories and HTML entry points. Each output must be independently usable as a static SPA and not depend on the other output directory.
- Public build includes Leaflet and public reporting code only. Admin build includes admin auth and inventory/import/export UI only. The app import graphs must make this true; merely hiding routes at runtime is insufficient.
- Vite `VITE_*` values are build-time client values. Only non-secret API/provider/UI settings belong in them. Never place JWT secrets, database credentials, or private provider credentials in either frontend build.
- Preserve public map/report environment behavior including tile-provider gates and device-recenter gate. The admin build has no reason to receive public tile keys or geocoder settings unless an implemented admin feature uses them.
- The selected hosting topology must route deep links to the matching app's `index.html` and connect browser API requests to the existing backend. Under option A, `/api` is reverse-proxied and the actual backend CORS/forwarded-header behavior must be verified. Backend startup/migration/DB path stays independent of frontend deployment.
- `frontend/Dockerfile` currently runs Vite dev server. The repository requires distinct app build artifacts, but does not require separate deployment units. The repository does not establish whether production uses Docker, Nginx, another static host, or a reverse proxy; these are **не визначено з репозиторію**. A later authorized deployment step may serve the two artifacts under separate origins or under one origin with separate paths.
- No deployment image, proxy, environment, DNS, TLS, or production endpoint is changed in this planning checkpoint.

## 9. CI and browser E2E plan

Keep the currently required workflow job names `frontend` and `backend` stable unless branch protection is intentionally changed in the same approved infrastructure checkpoint. The `frontend` job should install dependencies once, typecheck both app roots and shared contracts, run their unit/component suites, build both outputs, and assert output separation. The backend job and its PostGIS/migration checks remain as-is for this frontend-only split.

Add/build the following test layers in the later implementation checkpoint:

1. Public unit/component coverage continues for map, target transitions, report form, locality catalog, localization, and local simulated result.
2. Admin unit/component coverage for login state, protected navigation, list/detail/form, import preview/confirm/status/history, export requests, and logs/settings views.
3. Build-boundary checks verify each app output has its own HTML and does not include the other app's route/page/auth modules. Check actual module/output evidence rather than only URL behavior.
4. Public browser E2E continues on the public base URL. Admin browser E2E uses a real disposable PostgreSQL/PostGIS database with canonical migrations, a deterministic synthetic admin fixture, synthetic inventory/import data as needed, explicit cleanup/isolation, and the real Express auth/session/authorization path. Cover login, `/me`, a protected deep link, authenticated inventory flow, import/history flow, export request, and logout/session behavior. Developer or production DBs, production credentials, and client-only auth mocks are not substitutes for server authorization/session evidence.
5. Preserve `process-egress-research` and the browser job's process containment in `.github/workflows/ci.yml`, `frontend/playwright.config.ts`, and `scripts/research/contained-workload.sh`. Admin E2E must run in the same proven containment; no live provider or AUSEMIO request is allowed.
6. Required green-on-success and demonstrated red-on-failure behavior for mandatory checks remains required. Informational dependency/SQLFluff collectors must not be reported as zero findings solely because their jobs are green.

The current browser test support server is `backend/tests/e2e-support/server.ts`; inspect whether it can safely support synthetic admin-auth/DB state before extending it. Existing PostGIS integration fixtures in `backend/tests/integration/` are a source for test database setup, not a reason to use developer or production DBs.

## 10. Migration sequence for a buildable split

No implementation is authorized yet. After plan approval, topology-neutral application/source/build separation may proceed. Resolve the owner/infrastructure gates before the dependent topology-specific browser/API behavior or any deployment. Use this sequence:

1. **Preflight and characterization:** pin the active route inventory from `App.tsx`, run current tests/build, record current app bundle outputs and current public/admin requests. Confirm no undocumented admin URL consumer or deployment proxy assumption.
2. **Test/build scaffolding first:** add two Vite roots, HTML entry points, explicit TypeScript/test scripts, and distinct output paths while retaining the existing dependency lock and aggregate commands. Establish tests that both outputs build before moving application modules.
3. **Public extraction:** move public router/providers/pages/components/services; preserve paths and P2c/report behavior. Ensure no `AdminAuthProvider`, admin client, or admin route import is reachable from public entry. Keep public E2E green.
4. **Admin extraction:** move admin pages, router/layout, auth context/client and admin schemas/types into the admin app. Mount `AdminAuthProvider` only there. Keep backend `/api/admin` routes and `requireAdmin` enforcement unchanged.
5. **Shared contract extraction:** move only proven shared types (initially light-point/status contracts) into `frontend/shared`; avoid speculative utility/UI packages and cyclic imports.
6. **Topology-neutral local runtime:** run both dev servers against one backend and disposable PostgreSQL/PostGIS as appropriate. Validate workflows with the selected local test setup. Do not treat ports 5173/5174 as cookie-host isolation evidence. For host-isolation evidence, use distinct loopback-mapped test hostnames or document that the property is untested until a controlled deployment-like environment is available.
7. **CI and isolated browser acceptance:** extend frontend job to both apps and add admin E2E under the existing process-egress containment. Keep mandatory check names stable. Do not enable live providers or AUSEMIO.
8. **Topology/deployment contract review:** after selecting a topology, verify its output routing, SPA fallback, browser/API integration, auth, cookies, CORS, and CSRF evidence. Hostname/DNS/TLS, static hosting, reverse-proxy mapping, and independent deploy mechanics are deployment gates only when deployment is separately authorized. No actual DNS/deploy in P5 implementation planning.
9. **Independent implementation audit:** review route/bundle separation, API authorization, cookies/CSRF/CORS under exact origins, P3 regression results, CI evidence, and no external traffic before a separate merge decision.

Keep each intermediate commit buildable where practical. Do not keep a duplicate combined router after both apps pass; this is pre-production, so do not create speculative compatibility scaffolding. Do not change backend/database semantics to make frontend bundling convenient.

## 11. Acceptance criteria for a future implementation

### Application and build boundaries — topology-neutral P5 acceptance

- Same GitHub repository contains public and admin app roots, distinct HTML/entry/router modules, independent build commands, and separate build outputs.
- Public output contains the public map/report/result paths and does not include admin route/page/auth modules. Admin output contains admin login/workflows and does not include public map/report bundles or Leaflet unless a specific admin feature requires it.
- Public boot makes no `/api/admin/auth/me` request and does not initialize admin session state. Admin boot initializes `/me` and protected routing only in the admin application.
- Both outputs build independently and have import graphs that separate app-owned code. Public behavior and admin workflows remain preserved. Hosting/deep-link routing is topology acceptance after a topology is selected, not a prerequisite for this source/build split.
- Public map-first behavior, selected target continuity, report form, static locality catalog, bilingual behavior, provider gates, and local/simulated result remain unchanged.

### Admin behavior and backend boundary

- Admin login, refresh rotation, expired/revoked sessions, logout, and protected deep links work in synthetic/test environments through real Express auth/session/authorization behavior. Exact-origin and cookie-host claims are evaluated under the selected topology; localhost ports alone do not prove different cookie hosts.
- The `requireAdmin` server middleware still protects inventory, imports, exports, logs, and integration endpoints. Client route protection is never accepted as authorization.
- P3 inventory CRUD, PostGIS point behavior, import preview/queue/history, export formats/filters, audit logging, and migration chain pass existing backend integration coverage without schema or behavioral redesign.
- No new admin role/permission behavior is introduced without a separate owner decision.

### Topology and security acceptance — after a browser/API topology is selected

- Exact browser/API origins and the selected routing topology are documented. Under option A, tests prove browser requests are same-origin to each frontend host, verify proxy forwarding and actual Express CORS behavior, and demonstrate successful browser responses.
- Under option B, credentialed CORS allows only exact approved frontend origins; wildcard credentials are rejected. Tests cover allowed/rejected origins, preflight, cookie send/receive, and successful browser responses.
- For every selected topology, evidence covers unsafe authenticated admin methods and the applicable Origin/Referer, CSRF-token, SameSite/site, host-only cookie, cross-origin/cross-site form submission, credentialed-fetch, and allowed/rejected-origin cases. CORS, `SameSite=Lax`, and a same-origin proxy alone are not accepted as CSRF proof.
- When the topology is selected, direct/deep routing, the selected cookie-host behavior, and proxy/CORS behavior are tested using a representative controlled test setup. Local ports alone do not establish cookie-host isolation.

### Deployment acceptance — only when deployment is separately authorized

- Final hostname, DNS, TLS, static hosting, reverse-proxy routing, and operational ownership are approved and recorded.
- Deployment acceptance does not block topology-neutral application/build separation.

### CI and safety

- CI typechecks/tests/builds both apps, validates shared contracts and output separation, and keeps mandatory `frontend`/`backend` status names stable unless settings change is explicitly approved.
- Public and admin browser suites pass in the existing process-egress containment. A failed containment proof blocks browser E2E rather than falling back to an uncontained run.
- No AUSEMIO/live-provider traffic, real admin credentials, production data, P3 schema changes, or P3 persistence redesign are present in this work.

## 12. Owner and infrastructure decision gates

| Gate | Why it changes behavior/operations | Current recommendation / safe work before decision |
|---|---|---|
| **P5-O1 — final hostname and DNS/TLS owner** | Determines deployment origin, certificates, cookie host, allowlists, and hosting target | The suggested `admin.mapa.vra-ubuntu-server-0579.virtual.cloud.tuke.sk` is not binding. This is a deployment gate only; topology-neutral source/build separation can proceed after plan approval. Do not configure DNS/TLS in this checkpoint. |
| **P5-O2 — API/browser topology and proxy availability** | Determines topology-specific routing and browser/API, CORS, cookie behavior | Required before implementing topology-specific browser/API integration. The current recommendation is option A, but the owner/infrastructure choice is open. This does not block basic app/source/build separation. Verify engineering details from implementation evidence rather than inventing an owner choice. |
| **P5-O3 — independent deploy/release/rollback/version skew (optional)** | Matters only if the solution intends independent deploy cadence, rollback, or frontend/backend version skew | Separate applications and build artifacts are required; independently deployed release units are not. Leave undecided unless that capability is intended. Do not add speculative compatibility/versioning machinery. |
| **P5-O4 — auth/CSRF security evidence** | Current cookie-authenticated unsafe methods have no explicit CSRF middleware in the inspected path; every topology needs evidence for its browser-origin behavior | Required before approving topology-specific auth/origin behavior and before deployment, but does not block topology-neutral source/build extraction. Determine the control from implementation/security evidence; do not select a mechanism in this plan. No role-model expansion is implied. |

No owner decision is needed on repository structure beyond the already accepted same-repository direction, on whether the UI and backend authorization are distinct, or on which current pages belong to public/admin; those are determined by `App.tsx` and API route modules.

## 13. P5 risks and known boundaries

- **Auth boot coupling:** global `AdminAuthProvider` currently makes admin `/me` part of every app boot. A partial route move without entry/provider separation will leave coupling and admin code in the public build.
- **Cookie/CORS mismatch:** separate frontend origin alone does not determine cookie behavior. API destination host, scheme, site relationship, CORS, proxy headers, and cookie attributes must be tested together.
- **CSRF:** `SameSite=Lax` and CORS do not prove state-changing endpoints are CSRF-safe. Keep this an explicit security acceptance gate.
- **Deployment unknown:** repository provides local Compose and a Vite dev container, not production static hosting, Nginx, proxy, DNS, or TLS evidence. Do not describe proposed proxy behavior as live/current.
- **Static routing:** the selected topology needs routing/fallback rules that return the correct app for each deep link; validate route precedence if both builds share one origin.
- **Build-time config:** Vite `VITE_*` values are embedded at build time. Separate artifacts need deliberate, non-secret config and must not contain provider/database credentials.
- **CI drift:** branch protection currently relies on named checks; renaming `frontend` or `backend` without a coordinated settings change can remove required enforcement. Keep names stable by default.
- **Legacy/unwired UI:** `AdminLightPointsPage` is not routed in current `App.tsx`; migration must follow the active route graph, not directory names.
- **P3 regression:** frontend split must not modify backend migrations, PostGIS, import queue/history, export, identity, audit or APIs unless a separately approved technical finding proves it necessary.
- **Report integration boundary:** AUSEMIO production integration remains on hold. Existing local/simulated semantics must remain; no `/api/reports/send` production route or external request is added.

### Carried-forward P3 non-blocking P2 items (not P5 scope)

1. Ubuntu 24.04 / 2-vCPU / 4-GB resource validation has not been performed.
2. Maximum individual inventory/export row size remains unbounded.
3. Windows service-area line-ending/hash portability remains.
4. npm audit vulnerabilities/findings remain to be triaged.
5. SQLFluff findings and the large seed lint-coverage gap remain.
6. Geocoding no-op/race hardening and dedicated race-barrier tests remain.

These are recorded separately and must not be silently pulled into this frontend-separation checkpoint.

## 14. Independent plan-audit checklist

- Verify every current architecture claim against the named source path and ensure owner-provided host/pre-production facts are not presented as repository evidence.
- Confirm active public/admin route inventories match `frontend/src/App.tsx`; confirm the unmounted `AdminLightPointsPage` is not accidentally treated as active.
- Confirm only the two binding owner decisions are treated as binding: distinct public/admin applications/builds and the same GitHub repository. Check that origins, hostnames, deploy units/cadence, rollback, and version compatibility remain undecided.
- Challenge all deployment candidates, including option C, without treating a distinct admin subdomain as required; verify no proxy/DNS/TLS facts are assumed from this repository.
- Challenge whether a shared contract module is genuinely needed. Current evidence should move only `LightPointStatus`; inspect active imports before moving other types, mappings, helpers, or UI. Check whether one existing frontend dependency lock is sufficient.
- Independently review cookie host-only semantics, SameSite/Secure behavior, credentialed fetch, CORS, refresh/logout, server authorization, and CSRF unknowns for every selected topology, including option A. No recommendation may silently widen cookie scope or treat CORS/proxy/SameSite alone as CSRF proof.
- Verify admin browser E2E uses disposable PostgreSQL/PostGIS, canonical migrations, synthetic fixtures, explicit cleanup, real Express auth/session, and the required workflow coverage under process-egress containment.
- Verify localhost ports are not presented as separate cookie hosts or proof of host-only cookie isolation.
- Verify P3 boundary and no schema/migration/behavior redesign in the proposed sequence.
- Verify CI job-name stability and that browser E2E remains gated by process-egress containment.
- Check acceptance criteria prove bundle-level separation, not only UI route hiding.
- Run Markdown path/link checks and `git diff --check`; this documentation PR does not require application tests/builds.
- Confirm only the canonical P5 planning document changes and no implementation/deployment/provider traffic occurs.

## 15. Unknowns

- Final hostname/origin topology, DNS/TLS, static host, reverse-proxy product/configuration, independent deployment/release policy, and operational owner are **не визначено з репозиторію**; the proposed host is a recommendation, not an accepted DNS change.
- Current production API origin and whether `/api` is already reverse-proxied are **не визначено з репозиторію**. Under a future proxy topology, actual Express CORS behavior with forwarded request headers must be verified.
- Whether current host-level settings already provide SPA fallback, multiple frontend origins, or a path-based two-app deployment is **не визначено з репозиторію**.
- Whether any non-repository admin URL bookmarks or external links depend on `/panel-svietidla` is **не визначено з репозиторію**.
- Exact CSRF controls expected by the owner/security review are **не визначено з репозиторію**; no legal/security compliance conclusion is made here.
- The six carried-forward P2 items remain separate and are not resolved by app separation.

## 16. Checkpoint status

- **P5 planning:** targeted audit corrections documented; ready for targeted independent re-audit. Implementation and deployment are not authorized by this document.
- **Binding product scope:** separate public/admin applications and build artifacts in the same GitHub repository. Separate origins, hostnames, deploy units, cadence, rollback/version policy, and reverse-proxy topology remain undecided.
- **Architecture candidates:** one existing API/database; option A per-origin `/api` proxy is recommended but conditional; options B, C, and equivalent supported topologies remain open. `LightPointStatus` is the current minimum shared-contract candidate.
- **Implementation gates:** topology-neutral source/build separation may proceed after plan approval. P5-O2 and P5-O4 gate their dependent topology-specific browser/API/auth work; P5-O1 gates deployment only; P5-O3 is optional if independent release capability is desired.
- **Implementation/deployment:** not started or authorized by this planning artifact.
- **Backend/API/schema/dependencies/runtime/DNS:** unchanged.
- **AUSEMIO/live providers:** no access or traffic occurred.
