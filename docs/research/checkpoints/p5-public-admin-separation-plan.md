# P5 — Public/Admin Frontend Separation Plan

**Status:** planning draft — ready for independent plan audit. Implementation and deployment are not authorized by this document.
**Baseline:** `master` at `6be892f8ef6e9fc2a527b67f6a0c932df942310e` (P3 merge).
**Scope:** separate public and admin frontend applications/build artifacts in this repository; retain the Express API and PostgreSQL/PostGIS persistence unless an approved topology requires a narrow technical change.

## 1. Decision summary

The repository should remain one GitHub repository with two explicit frontend applications, each with its own entry point, router, build command, output directory, and deployable static artifact. The existing backend remains the single API and persistence service. P3 database/import/export behavior is preserved.

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

Keep the current frontend dependency installation and lockfile initially. Do not introduce npm workspaces or a separately versioned shared package unless implementation evidence shows they are needed. A small shared contract module is justified for the light-point/status types consumed by both applications; admin API/auth modules and public reporting modules should remain app-owned.

The deployment recommendation is two static origins, with the admin app on a distinct `admin.<domain>` host, and the same backend reachable as a same-origin `/api` reverse-proxy path from each app origin. This keeps the browser API calls same-origin and allows the existing host-only admin cookies to remain host-only. The reverse-proxy capability has not been established by repository configuration, so this is a recommendation pending infrastructure confirmation, not a claim about current hosting.

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
| Shared | Minimal dependency-light contracts actually imported by both (initial candidate: `LightPoint` / `LightPointStatus`); optionally common tokens only if both apps use them | App routing, auth, report flow, provider configuration, side-effectful API clients, duplicated business workflows |

Suggested build results are independent directories such as `frontend/dist/public/` and `frontend/dist/admin/`, each containing its own `index.html` and reachable chunks/assets. The exact Vite config arrangement is an implementation choice; each app must have an explicit root and build command. Keep one root `frontend/package-lock.json` and the existing package install initially, with named scripts for public/admin typecheck, tests, and builds. A new workspace/package graph is not justified solely by the current split.

The public router keeps `/` → `/map`, `/map`, `/report`, and `/result` semantics. The admin router owns the admin origin root, `/login`, and inventory/import/settings/log paths. Deep links must load the correct app's HTML through that origin's SPA fallback. The public router contains no admin fallback/redirect because the admin app has a different host; the admin app must not redirect unknown routes into public map flows.

Separate entry modules should mount only their own providers. The admin app mounts `AdminAuthProvider`; the public app does not. No admin API request should be caused by public boot. Both apps may use `BrowserRouter`, but must not import each other's `App`, page modules, auth context, or router config.

## 4. API topology options

| Option | Browser behavior | Advantages | Costs / gates |
|---|---|---|---|
| **A. Same-origin `/api` proxy on each frontend origin — recommended** | Public origin `/api/*` and admin origin `/api/*` are reverse-proxied to the same backend service | Same-origin fetch; admin cookie remains host-only at admin host; no credentialed browser CORS dependency; one backend and DB | Requires infrastructure to route both hostnames' `/api` to the same backend and preserve correct forwarded headers. Hosting/proxy support is not present in repo and must be confirmed. |
| B. One shared API origin called cross-origin by both apps | Both apps call an API URL using credentialed fetch; backend returns CORS headers for both exact app origins | One explicit API hostname and one backend route surface | Existing `CORS_ORIGIN` is a single string; it must become an exact allowlist if approved. Cookie `SameSite` behavior depends on whether the chosen API is same-site or cross-site. Cross-site cookies may require `SameSite=None; Secure`, which changes security behavior and needs security/owner approval. CSRF design must be reviewed; CORS alone is not CSRF protection. |
| C. Serve both apps under one origin with separate paths | Two builds but one browser origin | Simple local/static path routing | Does not meet the accepted distinct admin subdomain/origin requirement and is not an acceptable final deployment topology. It may be used only as a local development convenience. |

Recommend A for pre-production if the infrastructure owner confirms the reverse proxy. It needs no backend route or DB redesign. If A is unavailable, stop before implementing B and obtain the origin/cookie/CORS/CSRF decisions below. Do not silently widen cookie Domain or CORS origins.

## 5. Authentication, session, CORS, and security implications

Current implementation evidence:

- `backend/src/services/auth.service.ts` validates the username/password, checks `admins.is_active`, issues access and refresh JWTs, stores a hash of the refresh token in `admin_refresh_sessions`, rotates refresh tokens on refresh, and revokes sessions on refresh/logout.
- `backend/src/config/auth.ts` sets access lifetime to 1 hour and refresh lifetime to 30 days. `backend/src/utils/cookies.ts` sets `access_token` and `refresh_token` as `httpOnly`, `path: '/'`, `SameSite=Lax`; `Secure` is enabled only when `NODE_ENV=production`. No `Domain` option is set, so these are host-only cookies.
- `frontend/src/services/adminApi.ts` sends `credentials: 'include'` on requests and refresh. `AdminAuthContext` calls `/admin/auth/me` on app initialization. `/api/admin/auth/login`, `/refresh`, `/logout`, and `/me` are mounted in `backend/src/routes/adminAuth.routes.ts`.
- `backend/src/app.ts` configures CORS with one `config.corsOrigin` and `credentials: true`. `CORS_ORIGIN` defaults to `http://localhost:5173` in `backend/src/config/index.ts` and `.env.example`.
- `backend/src/routes/admin.routes.ts` leaves auth routes mounted before `requireAdmin`, then protects all admin inventory/log/integration routes. `AdminProtectedRoute` is client navigation control only; `requireAdmin` is the server authorization boundary.
- `admins` schema has identity/password/active fields but no role/permission column (`backend/src/db/migrations/0001_initial_schema.sql`). The current model is an active/inactive admin account, not a multi-role permission system.
- No explicit CSRF token or CSRF middleware was found in the inspected request path. This is an implementation/security gap to resolve through security research and tests before the new topology changes how browser origins are used. Do not claim that CORS or `SameSite=Lax` alone proves CSRF safety.

Target recommendation is to preserve host-only cookies and existing refresh/session behavior. In topology A, admin fetches `/api/...` from its own origin and the reverse proxy sends it to the same Express service; the browser stores/sends the cookie for the admin host. The public origin does not need the admin session and must not initialize it. Do not add a shared parent-domain `Domain` cookie.

If topology B is selected, require a documented exact-origin CORS allowlist for public and admin hosts, `credentials: true`, non-wildcard origin responses, and tests for allowed and rejected origins. Determine same-site/cross-site cookie behavior from the final exact HTTPS origins. Before any cookie attribute change, review CSRF protections for state-changing admin methods and test login, refresh rotation, logout, expired session, and revoked session. No auth redesign or new roles are in P5 scope unless a separate owner decision is recorded.

## 6. File/layout implementation map (planning only)

The following is the expected migration map, not a command to move files now.

| Current path/module | Planned target ownership | Notes |
|---|---|---|
| `frontend/index.html`, `frontend/src/main.tsx`, `frontend/src/App.tsx` | `frontend/apps/public/index.html` + public entry/router; add `frontend/apps/admin/index.html` + admin entry/router | Split entry and route trees. Do not wrap public app in admin auth. |
| `frontend/src/pages/MapPage/`, `ReportFormPage/`, `ResultPage/`, `frontend/src/components/LightPointsMap/`, `TargetConfirmationDialog/`, `LocalityCombobox/`, public locale/i18n, report config/utilities | `frontend/apps/public/src/` | Preserve map-first, geolocation/location activation, report form and local/simulated sink behavior. |
| `frontend/src/pages/AdminLoginPage/`, `AdminDashboardPage/`, `AdminStreetLightsPage/`, `AdminStreetLightFormPage/`, `AdminStreetLightDetailPage/`, `AdminImportPage/`, `AdminSettingsPage/`, `AdminLogsPage/`, `frontend/src/components/AdminLayout/`, `AdminProtectedRoute/` | `frontend/apps/admin/src/` | Keep P3 workflows and server-side guards intact. |
| `frontend/src/context/AdminAuthContext.tsx`, `frontend/src/services/adminApi.ts`, `frontend/src/config/adminRoutes.ts`, `frontend/src/schemas/adminSchema.ts`, `streetLightSchema.ts`, `frontend/src/types/admin.ts`, `frontend/src/styles/adminShared.module.css` | `frontend/apps/admin/src/` | Admin-only auth/API/routing/schema/style code. Delete/replace `VITE_ADMIN_BASE_PATH` only after route and hostname migration acceptance is met. |
| `frontend/src/types/lightPoint.ts` (and only the types truly imported by both apps) | `frontend/shared/contracts/lightPoint.ts` | First shared module candidate; keep runtime services out of the shared package. Verify actual imports during implementation. |
| `frontend/vite.config.ts`, `frontend/tsconfig*.json`, `frontend/vitest.config.ts`, `frontend/playwright.config.ts`, `frontend/package.json` | Frontend orchestration plus app-specific Vite/TS/test configs as evidence requires | Keep one lockfile initially. Set independent roots/output directories and aggregate scripts. Preserve the egress gate in Playwright. |
| `frontend/tests/unit/`, `frontend/tests/e2e/` | App-specific unit/component/E2E suites or explicit project configs | Keep existing public tests and add admin tests for real active workflows. Do not move tests by filename alone; align each with imports/ownership. |
| `backend/src/app.ts`, `backend/src/routes/admin.routes.ts`, `backend/src/services/`, `backend/src/db/`, `backend/src/db/migrations/`, `database/` | **Remain unchanged** for the recommended topology | Only a separately approved technical requirement may change CORS/proxy handling. No schema/migration change is planned. |
| `docker-compose.yml`, `docker-compose.dev.yml`, `.github/workflows/ci.yml` | Later implementation may add two dev app services and run both frontend builds/tests | Preserve required job names and process-egress browser containment. Do not implement DNS/TLS/prod proxy here. |

The current active route list in `App.tsx` is the authority for screens to move. Do not silently wire in the currently unreferenced `AdminLightPointsPage` or remove other legacy modules without a focused usage check.

## 7. Local development target

Use independent Vite servers, for example public `localhost:5173` and admin `localhost:5174`, with the existing backend on `localhost:5000` and PostgreSQL/PostGIS on `localhost:5432`. Each dev server owns its own `index.html`, router, Vite config, and HMR graph. The public and admin applications remain independently startable; starting one must not implicitly mount routes from the other.

Prefer a Vite `/api` dev proxy from each app to `http://localhost:5000` with app-local `VITE_API_URL=/api`. This keeps browser calls same-origin and exercises the recommended API path. If direct cross-origin requests to port `5000` are used for a test, configure an explicit test origin and do not treat that test setup as the production origin decision.

Add clear frontend scripts such as `dev:public`, `dev:admin`, `build:public`, `build:admin`, `typecheck:public`, `typecheck:admin`, and aggregate `build`, `test`, and typecheck commands. Do not duplicate `node_modules` or lockfiles without measured need. Compose may later offer `frontend-public` and `frontend-admin` dev services, while backend/PostGIS remain the current services.

## 8. Build and deployment artifact behavior

- Build public and admin as separate Vite roots with distinct output directories and HTML entry points. Each output must be independently usable as a static SPA and not depend on the other output directory.
- Public build includes Leaflet and public reporting code only. Admin build includes admin auth and inventory/import/export UI only. The app import graphs must make this true; merely hiding routes at runtime is insufficient.
- Vite `VITE_*` values are build-time client values. Only non-secret API/provider/UI settings belong in them. Never place JWT secrets, database credentials, or private provider credentials in either frontend build.
- Preserve public map/report environment behavior including tile-provider gates and device-recenter gate. The admin build has no reason to receive public tile keys or geocoder settings unless an implemented admin feature uses them.
- Each app's static host needs history fallback to that app's own `index.html` for its deep routes. `/api` must be reverse-proxied to the existing backend under the recommended topology. Backend startup/migration/DB path stays independent of frontend deployment.
- `frontend/Dockerfile` currently runs Vite dev server. A later deployment implementation must choose separate static artifacts/containers or equivalent hosting units. The repository does not establish whether production uses Docker, Nginx, another static host, or a reverse proxy; these are **не визначено з репозиторію**.
- No deployment image, proxy, environment, DNS, TLS, or production endpoint is changed in this planning checkpoint.

## 9. CI and browser E2E plan

Keep the currently required workflow job names `frontend` and `backend` stable unless branch protection is intentionally changed in the same approved infrastructure checkpoint. The `frontend` job should install dependencies once, typecheck both app roots and shared contracts, run their unit/component suites, build both outputs, and assert output separation. The backend job and its PostGIS/migration checks remain as-is for this frontend-only split.

Add/build the following test layers in the later implementation checkpoint:

1. Public unit/component coverage continues for map, target transitions, report form, locality catalog, localization, and local simulated result.
2. Admin unit/component coverage for login state, protected navigation, list/detail/form, import preview/confirm/status/history, export requests, and logs/settings views.
3. Build-boundary checks verify each app output has its own HTML and does not include the other app's route/page/auth modules. Check actual module/output evidence rather than only URL behavior.
4. Public browser E2E continues on the public base URL. Admin E2E uses a synthetic admin and test database/backend; cover login, `/me`, refresh/expiry/logout, protected direct navigation, inventory CRUD, import and export contracts. Do not use production credentials/data.
5. Preserve `process-egress-research` and the browser job's process containment in `.github/workflows/ci.yml`, `frontend/playwright.config.ts`, and `scripts/research/contained-workload.sh`. Admin E2E must run in the same proven containment; no live provider or AUSEMIO request is allowed.
6. Required green-on-success and demonstrated red-on-failure behavior for mandatory checks remains required. Informational dependency/SQLFluff collectors must not be reported as zero findings solely because their jobs are green.

The current browser test support server is `backend/tests/e2e-support/server.ts`; inspect whether it can safely support synthetic admin-auth/DB state before extending it. Existing PostGIS integration fixtures in `backend/tests/integration/` are a source for test database setup, not a reason to use developer or production DBs.

## 10. Migration sequence for a buildable split

No implementation is authorized yet. After independent plan audit and owner/infrastructure gates, use this sequence:

1. **Preflight and characterization:** pin the active route inventory from `App.tsx`, run current tests/build, record current app bundle outputs and current public/admin requests. Confirm no undocumented admin URL consumer or deployment proxy assumption.
2. **Test/build scaffolding first:** add two Vite roots, HTML entry points, explicit TypeScript/test scripts, and distinct output paths while retaining the existing dependency lock and aggregate commands. Establish tests that both outputs build before moving application modules.
3. **Public extraction:** move public router/providers/pages/components/services; preserve paths and P2c/report behavior. Ensure no `AdminAuthProvider`, admin client, or admin route import is reachable from public entry. Keep public E2E green.
4. **Admin extraction:** move admin pages, router/layout, auth context/client and admin schemas/types into the admin app. Mount `AdminAuthProvider` only there. Keep backend `/api/admin` routes and `requireAdmin` enforcement unchanged.
5. **Shared contract extraction:** move only proven shared types (initially light-point/status contracts) into `frontend/shared`; avoid speculative utility/UI packages and cyclic imports.
6. **Local API proxy and app runtime:** run both dev servers against one backend and disposable PostgreSQL/PostGIS as appropriate. Confirm host-only cookies, login, refresh, logout, CRUD/import/export and logs under the chosen origins.
7. **CI and isolated browser acceptance:** extend frontend job to both apps and add admin E2E under the existing process-egress containment. Keep mandatory check names stable. Do not enable live providers or AUSEMIO.
8. **Build/deployment contract review:** verify output directories, SPA fallback and `/api` routing requirements. Infrastructure owner then chooses/approves hostname, DNS/TLS, static hosting, reverse-proxy mapping, and independent deploy mechanics in a distinct deployment step. No actual DNS/deploy in P5 implementation planning.
9. **Independent implementation audit:** review route/bundle separation, API authorization, cookies/CSRF/CORS under exact origins, P3 regression results, CI evidence, and no external traffic before a separate merge decision.

Keep each intermediate commit buildable where practical. Do not keep a duplicate combined router after both apps pass; this is pre-production, so do not create speculative compatibility scaffolding. Do not change backend/database semantics to make frontend bundling convenient.

## 11. Acceptance criteria for a future implementation

### Application and build boundaries

- Same GitHub repository contains public and admin app roots, distinct HTML/entry/router modules, independent build commands, and separate build outputs.
- Public output contains the public map/report/result paths and does not include admin route/page/auth modules. Admin output contains admin login/workflows and does not include public map/report bundles or Leaflet unless a specific admin feature requires it.
- Public boot makes no `/api/admin/auth/me` request and does not initialize admin session state. Admin boot initializes `/me` and protected routing only in the admin application.
- Both apps can be built and served separately. Direct route refresh works for each app through the correct SPA fallback; unknown routes remain within that app.
- Public map-first behavior, selected target continuity, report form, static locality catalog, bilingual behavior, provider gates, and local/simulated result remain unchanged.

### Admin behavior and backend boundary

- Admin login, refresh rotation, expired/revoked sessions, logout, and protected deep links work in synthetic/test environments with the chosen exact origins and HTTPS-equivalent cookie settings.
- The `requireAdmin` server middleware still protects inventory, imports, exports, logs, and integration endpoints. Client route protection is never accepted as authorization.
- P3 inventory CRUD, PostGIS point behavior, import preview/queue/history, export formats/filters, audit logging, and migration chain pass existing backend integration coverage without schema or behavioral redesign.
- No new admin role/permission behavior is introduced without a separate owner decision.

### Origin, CSRF, and deployment

- Exact public/admin/API origins are documented; approved DNS/TLS/proxy ownership is recorded before deployment.
- Under the recommended topology, browser calls use same-origin `/api` and the admin cookies remain host-only, HttpOnly, `Secure` in production, and retain approved SameSite behavior.
- If cross-origin API is selected, credentialed CORS allows only exact approved frontend origins; wildcard credentials are rejected. Tests cover allowed/denied origins, preflight, cookie send/receive, and CSRF defenses for unsafe actions.
- Static output, history fallback, and `/api` proxy behavior are validated independently for both hosts. This does not claim a production deployment before infra confirms it.

### CI and safety

- CI typechecks/tests/builds both apps, validates shared contracts and output separation, and keeps mandatory `frontend`/`backend` status names stable unless settings change is explicitly approved.
- Public and admin browser suites pass in the existing process-egress containment. A failed containment proof blocks browser E2E rather than falling back to an uncontained run.
- No AUSEMIO/live-provider traffic, real admin credentials, production data, P3 schema changes, or P3 persistence redesign are present in this work.

## 12. Owner and infrastructure decision gates

| Gate | Why it changes behavior/operations | Current recommendation / safe work before decision |
|---|---|---|
| **P5-O1 — final admin hostname and DNS/TLS owner** | Determines the admin origin, certificates, cookie host, allowlists, and static hosting target | The suggested `admin.mapa.vra-ubuntu-server-0579.virtual.cloud.tuke.sk` is not binding. Continue code/layout planning; do not configure DNS/TLS. |
| **P5-O2 — API topology and reverse-proxy availability** | Determines same-origin proxy versus credentialed cross-origin CORS/cookie behavior | Recommend each frontend origin proxy `/api` to the one existing backend. Infrastructure must confirm support; if unavailable, stop before changing auth/CORS/cookie settings and decide topology explicitly. |
| **P5-O3 — independent deployment/release coupling** | Separate app/build/deployment boundary is required, but exact independent release cadence and compatibility policy are not in code | Recommend separate static artifacts and deploy units; keep backend shared. Owner/infra confirms whether each app must deploy independently and who operates rollback. |
| **P5-O4 — auth/CSRF behavior if topology requires a change** | Current cookie-based unsafe endpoints have no explicit CSRF middleware in the inspected path; topology may alter same-site/cross-origin exposure | Preserve current host-only/session behavior where possible. Obtain security review and owner approval for any cookie scope/SameSite, CSRF, or credentialed CORS behavior change. No role-model expansion is implied. |

No owner decision is needed on repository structure beyond the already accepted same-repository direction, on whether the UI and backend authorization are distinct, or on which current pages belong to public/admin; those are determined by `App.tsx` and API route modules.

## 13. P5 risks and known boundaries

- **Auth boot coupling:** global `AdminAuthProvider` currently makes admin `/me` part of every app boot. A partial route move without entry/provider separation will leave coupling and admin code in the public build.
- **Cookie/CORS mismatch:** separate frontend origin alone does not determine cookie behavior. API destination host, scheme, site relationship, CORS, proxy headers, and cookie attributes must be tested together.
- **CSRF:** `SameSite=Lax` and CORS do not prove state-changing endpoints are CSRF-safe. Keep this an explicit security acceptance gate.
- **Deployment unknown:** repository provides local Compose and a Vite dev container, not production static hosting, Nginx, proxy, DNS, or TLS evidence. Do not describe proposed proxy behavior as live/current.
- **Static routing:** both origins need their own deep-link fallback; a public-host fallback must not return the public app for admin routes.
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
- Challenge whether a shared contract module is genuinely needed and whether one existing frontend dependency lock is sufficient.
- Challenge the recommended `/api` reverse-proxy topology against real hosting capabilities; verify no proxy/DNS/TLS facts are assumed from this repository.
- Independently review cookie host-only semantics, SameSite/Secure behavior, credentialed fetch, CORS, refresh/logout, server authorization, and CSRF unknowns. No recommendation may silently widen cookie scope.
- Verify P3 boundary and no schema/migration/behavior redesign in the proposed sequence.
- Verify CI job-name stability and that browser E2E remains gated by process-egress containment.
- Check acceptance criteria prove bundle-level separation, not only UI route hiding.
- Run Markdown path/link checks and `git diff --check`; this documentation PR does not require application tests/builds.
- Confirm only the canonical P5 planning document changes and no implementation/deployment/provider traffic occurs.

## 15. Unknowns

- Exact admin hostname, DNS/TLS, static host, reverse-proxy product/configuration, and operational owner are **не визначено з репозиторію**; the proposed host is owner-provided guidance, not an accepted DNS change.
- Current production API origin and whether `/api` is already reverse-proxied are **не визначено з репозиторію**.
- Whether current host-level settings already provide SPA fallback, multiple frontend origins, or independent artifact deployment is **не визначено з репозиторію**.
- Whether any non-repository admin URL bookmarks or external links depend on `/panel-svietidla` is **не визначено з репозиторію**.
- Exact CSRF controls expected by the owner/security review are **не визначено з репозиторію**; no legal/security compliance conclusion is made here.
- The six carried-forward P2 items remain separate and are not resolved by app separation.

## 16. Checkpoint status

- **P5 planning:** documented from current source and owner-provided deployment context; ready for independent plan audit.
- **Architecture recommendation:** same repository, separate public/admin app roots and build artifacts, minimal shared contracts, one existing API/database; recommend same-origin `/api` reverse proxy per frontend origin subject to infrastructure confirmation.
- **Owner decisions still required before topology-specific implementation/deployment:** P5-O1 through P5-O4 where applicable.
- **Implementation/deployment:** not started or authorized by this planning artifact.
- **Backend/API/schema/dependencies/runtime/DNS:** unchanged.
- **AUSEMIO/live providers:** no access or traffic occurred.
