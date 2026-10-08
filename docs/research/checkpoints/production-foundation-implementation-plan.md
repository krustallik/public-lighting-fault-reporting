# Production foundation implementation plan

**Status:** CORRECTED AFTER INDEPENDENT PLAN AUDIT FAIL — READY FOR TARGETED RE-AUDIT (prior result P0=0, P1=4, P2=5); planning only, no implementation or deployment is authorized.
**Repository:** krustallik/public-lighting-fault-reporting
**Baseline:** master at c2c03bba0435cc72dbffd27eea2f20ac81202142 (2026-10-08).
**Scope:** production serving, private network boundaries, fail-closed configuration, admin browser security, first-admin bootstrap, targeted runtime dependency remediation, approved provider setup, and CI evidence.

## 1. Executive summary and binding scope

Treat these owner decisions as final requirements:

- First production public application is **non-submitting to AUSEMIO/municipal systems**. AUSEMIO stays **ON HOLD**. Local/simulated test behavior must never claim that a real report was delivered or accepted.
- Public and admin are separate browser applications/origins:
  - Public: https://mapa.vra-ubuntu-server-0579.virtual.cloud.tuke.sk
  - Admin: https://admin.mapa.vra-ubuntu-server-0579.virtual.cloud.tuke.sk
- Each origin serves its own production static build and same-origin /api path. Both API paths reach one private Express backend.
- The backend is not directly Internet-facing. PostgreSQL/PostGIS is private.
- Target host is fixed: Ubuntu 24.04, 2 vCPU, 4 GB RAM, 250 GB disk.
- Production map tiles are ON with CARTO. Production geocoding means public/report address suggestion through Geoapify is ON. Automatic/CLI inventory/light-point enrichment is explicitly OFF and outside this release; `NOMINATIM_AUTO_GEOCODE=false`, the legacy inventory CLI is not run in production, and public Nominatim is not an approved fallback.
- Import/history/audit/admin operational history retention target is one year. RPO is 24 hours; RTO is 4 hours.
- Product scope remains public lighting and AUSEMIO service 2 / VO only. Service 16 / CSS is OUT OF PRODUCT SCOPE.

This plan is evidence-based, not an application audit or deployment approval. It separates current repository facts, owner-provided facts, external vendor documentation, and proposed infrastructure. No source code, database, DNS, TLS, credentials, provider traffic, or AUSEMIO behavior was changed or exercised here.

### Evidence labels

- **Repo-confirmed** means observable in checked master source/configuration.
- **Owner-provided** means stated in the request but not independently verified from runtime data.
- **External-doc confirmed** means stated by linked official documentation checked 2026-10-08.
- **Proposed** means implementation recommendation, not current deployed behavior.
- **Unknown** means the repository does not establish it.

### Production-readiness audit provenance

The production-readiness gap audit is an **owner-supplied external audit artifact**, not repository-source evidence. Its owner-supplied summary is: thesis/pre-production is **READY for controlled non-submitting use**; production is **NOT READY**; P0=0, P1=7, P2=8. This summary is recorded as owner-provided and was not independently reconstructed from repository source. A canonical repository path is not required and finding one is not a deployment gate. This audit does not authorize implementation or deployment.

## 2. Current facts and source evidence

| Area | Current state in checked master | Evidence |
|---|---|---|
| Public/admin frontends | Separate Vite roots, app entry points, scripts, and build outputs exist: public to frontend/dist/public and admin to frontend/dist/admin. This is an application/build split, not deployed hosting. | frontend/package.json; frontend/apps/public/index.html; frontend/apps/public/src/main.tsx; frontend/apps/public/vite.config.ts; frontend/apps/admin/index.html; frontend/apps/admin/src/main.tsx; frontend/apps/admin/vite.config.ts; frontend/scripts/check-app-build-boundaries.mjs |
| Frontend runtime | Both Docker services still run Vite development servers. No production static server/proxy configuration is present in checked master. | frontend/Dockerfile; docker-compose.yml; docker-compose.dev.yml |
| Backend runtime | Node 20, ESM TypeScript/NodeNext, Express. backend/src/index.ts connects PostgreSQL, runs migrations on startup, starts the import worker, optionally runs legacy inventory geocoding, then listens on port 5000. | backend/package.json; backend/tsconfig.json; backend/src/index.ts; backend/src/app.ts |
| API mounts | Health; public reverse address suggestion; light points; development/test submit sink; admin routes. Admin auth routes mount before requireAdmin; remaining admin groups are protected. | backend/src/app.ts; backend/src/routes/admin.routes.ts; backend/src/routes/adminAuth.routes.ts; backend/src/routes/ausemioTest.routes.ts |
| AUSEMIO submission | No active real production /api/reports/send transport is present. Local test submission is gated to development/test plus explicit flag. Current report semantics are simulated/local. | backend/src/routes/ausemioTest.routes.ts; backend/src/services/reports.service.ts; backend/src/app.ts; frontend local submission transport/tests |
| Current Docker exposure | Root Compose publishes PostgreSQL 5432, backend 5000, public Vite 5173, and admin Vite 5174 to the host. These are development defaults, not the approved production boundary. | docker-compose.yml; docker-compose.dev.yml |
| Unsafe development defaults | Compose defaults to NODE_ENV=development, DB user/password postgres, JWT secret dev-only-change-in-production, and ADMIN_INITIAL_PASSWORD=admin123. These values must not reach a production launch. | docker-compose.yml; .env.example; backend/src/config/index.ts; backend/src/config/auth.ts |
| CORS | Express uses one credentialed CORS origin from process-level config, defaulting to http://localhost:5173. createApp accepts an env argument, but app.ts reads imported config.corsOrigin, so test-injected env and CORS config are not fully aligned. | backend/src/app.ts; backend/src/config/index.ts |
| Proxy trust | TRUST_PROXY_CIDRS is parsed into a custom CIDR predicate; empty means Express trusts no proxy. Express req.ip feeds address-suggestion and login limiters. | backend/src/app.ts; backend/src/security/clientAddress.ts; backend/src/security/addressIpLimiter.ts; backend/src/middleware/loginRateLimit.ts |
| Auth | Access/refresh JWTs use a defaultable secret; access lifetime 1 hour, refresh 30 days. Refresh tokens are hashed in DB and rotated/revoked. Cookies are HttpOnly, SameSite=Lax, host-only (no Domain), Path=/, and Secure only when config sees production. | backend/src/config/auth.ts; backend/src/services/auth.service.ts; backend/src/utils/cookies.ts |
| Authorization | Admin table has active/inactive state and no roles column. requireAdmin protects inventory/import/export/log/integration routes after auth routes. | backend/src/db/migrations/0001_initial_schema.sql; backend/src/routes/admin.routes.ts; backend/src/middleware/requireAdmin.ts |
| Admin bootstrap | No supported first-production-admin path was found. Existing seed is limited to development/test DB names and ALLOW_DESTRUCTIVE_SEED. | backend/src/scripts/seedDevelopment.ts; database/seed.sql |
| Database | Migrations 0001/0002 define inventory, admins, refresh sessions, import history/rows, integration logs, admin activity, and inventory audit events. | backend/src/db/migrations/0001_initial_schema.sql; backend/src/db/migrations/0002_p3_postgis_inventory.sql; backend/src/db/migrate.ts |
| Migration startup | Main backend invokes runMigrations() on startup; production does not separate migration credentials from runtime credentials. | backend/src/index.ts; backend/src/db/migrate.ts; backend/src/scripts/migrateDatabase.ts |
| Health | /api/health runs SELECT 1. It demonstrates a DB query, not provider readiness or end-to-end production readiness. | backend/src/routes/health.routes.ts; backend/src/services/health.service.ts |
| Map tiles | Public browser bundle supports CARTO raster URL generation; it requires VITE_CARTO_TILES_APPROVED=true and VITE_CARTO_PUBLIC_KEY. Missing config silently disables tiles. Dev OSM and synthetic modes are disabled in production. | frontend/apps/public/src/config/mapTiles.ts |
| Address provider | Geoapify reverse provider exists server-side, pinned to HTTPS api-eu.geoapify.com; GEOAPIFY_ENABLED defaults false, key is server-side, timeout/admission bounds and fake transport seams exist. | backend/src/config/addressProvider.ts; backend/src/providers/geoapifyAddressProvider.ts; backend/src/services/reportAddressSuggestion.service.ts; backend/src/app.ts |
| Legacy inventory geocoder | A separate inventory reverse-geocoder uses Nominatim; NOMINATIM_AUTO_GEOCODE defaults false, but explicit CLI can invoke it. It is not the Geoapify public address-suggestion service. | backend/src/config/index.ts; backend/src/services/geocoding.service.ts; backend/src/services/lightPoints.service.ts; backend/src/scripts/geocodeLightPoints.ts |
| Data persistence | Citizen reports are not persisted. Inventory, admin sessions, import and audit history are persisted. integration_logs has request_payload/response_payload JSONB columns; no current real AUSEMIO transport is enabled. | backend/src/db/migrations/0001_initial_schema.sql; backend/src/db/migrations/0002_p3_postgis_inventory.sql; backend/src/services/reports.service.ts |
| Retention/backup | No one-year cleanup job, scheduled backup, restore procedure, or measured RPO/RTO proof was found in checked source/config. Owner targets are recorded as future DB-operations requirements. | migrations; repository file search |
| Runtime images | Current backend image uses npm install and has no production non-root/read-only profile. Current frontend image is development-only. | backend/Dockerfile; frontend/Dockerfile |
| CI | Existing jobs: frontend, backend, process-egress-research, browser-e2e, dependency-audit-report, sqlfluff-report. Only the process-egress synthetic workload and browser-e2e workload use the contained process-egress namespace; ordinary frontend/backend test jobs are not globally network-contained. Dependency and SQLFluff jobs are informational. | .github/workflows/ci.yml; scripts/research/contained-workload.sh; frontend/playwright.config.ts |

The P5 implementation checkpoint records merged implementation evidence, but its older planning document contains pre-decision recommendations and must not override these owner decisions. Use current code for behavior and [P5 implementation checkpoint](p5-implementation.md) for implementation/CI evidence only.

## 3. Proposed architecture

### 3.1 Logical topology

**Proposed:** one Nginx edge publishes only TCP 80/443.

    Interne
      ├── HTTPS mapa.vra-ubuntu-server-0579.virtual.cloud.tuke.sk
      │     ├── public static root: frontend/dist/public
      │     └── same-origin /api/* ──────────────┐
      └── HTTPS admin.mapa.vra-ubuntu-server-0579.virtual.cloud.tuke.sk
            ├── admin static root: frontend/dist/admin
            └── same-origin /api/* ──────────────┤
                                                   ▼
                                        private Express backend:5000
                                          ├── private PostgreSQL/PostGIS
                                          └── outbound HTTPS Geoapify only

    Public browsers ── HTTPS raster tiles ──> CARTO

Exact DNS records, certificate issuance/renewal, and firewall operation are separate infrastructure work and are not performed by this plan.

Nginx is shared edge infrastructure, not a merged public/admin application artifact. Keep public and admin build outputs/release inputs separate so either static build can be replaced independently. Nginx selects the correct root by exact Host/server_name. Never serve admin under the public hostname or public under the admin hostname.

### 3.2 Network boundaries

Use a production deployment definition distinct from current development Compose:

1. **Ingress:** only Nginx is published on host ports 80/443. Configure host firewall to admit intended public ingress and SSH administration.
2. **API-private network:** Nginx and backend only. Backend has no host-published 5000 port. Give the proxy a stable private address or narrowly scoped subnet so TRUST_PROXY_CIDRS contains only the actual proxy address.
3. **DB-private network:** backend and PostgreSQL only, marked internal. PostgreSQL has no host-published 5432 port and is not attached to ingress.
4. **Provider egress:** backend needs outbound HTTPS to allowlisted Geoapify EU API; PostgreSQL and Nginx do not. Enforce host/container egress policy where supported; at application level retain fixed Geoapify hostname allowlist. Browser downloads CARTO tiles directly, so CARTO requires no backend secret or server route.
5. No other service gets access to DB-private. Direct access to backend/DB from Internet must fail at host firewall and container-network boundaries.

Compose internal networks have no external gateway; a service on both internal and normal egress networks can still access Internet. Backend therefore needs deliberate network memberships, not one default network shared by every service. See [Docker Compose networking](https://docs.docker.com/compose/how-tos/networking/).

### 3.3 Serving/proxy choice

| Option | Fit | Trade-off |
|---|---|---|
| **Nginx — recommended** | Mature static roots, explicit host routing, stable client-body limits, forwarded-header overwrite, cache and proxy-buffer controls. Fits the current 5 MiB single-file import. | TLS certificate/renewal needs explicit infrastructure lifecycle; Nginx does not automatically issue certificates. |
| Caddy | Official examples cover host-specific static serving, SPA fallback and API proxy; automatic HTTPS can reduce certificate operations. | Automatic HTTPS requires working DNS and public ports 80/443. Current request_body max_size is documented experimental in v2.10+, so version-specific verification is required before relying on it as the upload bound. |

Recommend Nginx for predictable body/header/routing controls and because TLS operations require an infrastructure runbook either way. This is a technical recommendation, not an owner product decision. If infrastructure mandates another proxy, preserve the same acceptance tests.

Nginx requirements:

- One server block per exact approved hostname. Unknown Host values return 444/404 and never fall through to SPA.
- Public root points only to frontend/dist/public. Admin root points only to frontend/dist/admin.
- Each has its own SPA fallback to its own index.html. Match /api and /api/ before SPA fallback and proxy path unchanged. API paths never return index.html.
- Public-host API allowlist: health, public light-point reads, public address suggestion. Deny /api/admin/* on public host. Admin-host API allowlist includes health and /api/admin/*. Do not expose local test submit on either. Backend authorization remains.
- Backend listens on internal interface/port 5000 only, not published on host. PostgreSQL has only DB-private access.
- Overwrite, do not append client-supplied values for the sole trusted hop: Host/X-Forwarded-Host from validated host, X-Forwarded-Proto from TLS scheme, X-Forwarded-For from observed socket peer. Do not trust incoming Forwarded or X-Forwarded-* chains.
- Finite header/body/read/write timeouts. No unbounded buffering. Import takes one file, Multer currently caps it at 5 MiB; proxy whole-body limit 6 MiB allows multipart framing. Test max file and over-limit request. Do not expose report-file/local-test uploads.
- Bounded client-body temp storage with explicit disk budget/cleanup. Do not buffer arbitrary request sizes in memory/disk.
- API, login/refresh/logout, admin exports and health use Cache-Control no-store/private. Hashed assets may be long-lived immutable. index.html uses revalidation/no-cache.
- Disable proxy caching for API, Set-Cookie, exports, and errors. Preserve export headers and stream with bounded buffers/temp space.

Nginx official docs define client_max_body_size, try_files, proxy_set_header, and proxy buffering/temp files: [core HTTP module](https://nginx.org/en/docs/http/ngx_http_core_module.html), [proxy HTTP module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html). No Nginx/TLS/DNS config exists in master.

## 4. Runtime/build boundaries and fail-closed configuration

### 4.1 Runtime images and static build

- Build public and admin artifacts from existing Vite roots into separate outputs. Admin uses root base path on its own host. Do not carry old admin-subpath assumptions into public app.
- Serve only built assets in production. Vite dev server, hot reload, development proxy, dev routes are not production runtime.
- Use multi-stage images: frontend build then Nginx static runtime; backend build then Node runtime with production dependencies only. Pin image versions/digests, npm ci with committed lockfiles, run Node as non-root, read-only runtime filesystem except explicit tmpfs/volume paths.
- Keep public/admin build inputs/version identifiers separate. Record public build SHA, admin build SHA, backend commit SHA, migration version, and proxy config version.
- CARTO key is public/client-visible. Geoapify/DB/JWT secrets never enter VITE_* or frontend build args.

### 4.2 Required production config

Introduce one testable production validation boundary before opening DB, starting workers or binding port. Avoid import-time defaults silently flowing into production. Development defaults may remain outside production.

| Setting | Production requirement |
|---|---|
| NODE_ENV | Exactly production; missing/development fails. |
| JWT_SECRET | Generate at least 32 random bytes (256 bits) with a CSPRNG and encode as base64url. Runtime validates presence, encoding and decoded length, and rejects known/default or obviously weak values; it cannot prove the actual entropy of an arbitrary supplied string. Infra secret storage only; never log. |
| DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD | Explicit; no postgres/default password. DB_USER is runtime role, not postgres/migration owner. |
| MIGRATION_DB_* | Separate deploy-only credentials. HTTP process never gets them. |
| PUBLIC_ORIGIN, ADMIN_ORIGIN | Exact HTTPS origins above; no wildcard, path or broad suffix. |
| TRUST_PROXY_CIDRS | Required/non-empty; exact stable Nginx address (/32 or narrow equivalent), not 0.0.0.0/0 or whole LAN. |
| CORS | Disabled for production same-origin browser APIs. Future cross-origin client needs separate justification and exact allowlist. |
| CARTO | VITE_MAP_TILE_PROVIDER=carto, VITE_CARTO_TILES_APPROVED=true, VITE_CARTO_PUBLIC_KEY set for public build. Missing config fails build, not silent blank map. |
| Geoapify | GEOAPIFY_ENABLED=true for public/report address suggestion only; server-only GEOAPIFY_API_KEY required; base remains https://api-eu.geoapify.com. Inventory enrichment stays OFF. Validate timeout, queue, spacing, expiry, IP limits, daily budget. |
| Held/legacy integrations | NOMINATIM_AUTO_GEOCODE=false; AUSEMIO_API_KEY absent; LOCAL_TEST_SUBMIT_ENABLED=false; no real AUSEMIO route. Violation fails startup/build. |
| Frontend API | VITE_API_URL=/api for both apps; no localhost:5000 in production artifacts. |
| Bootstrap | No ADMIN_INITIAL_PASSWORD in production runtime/source; one-shot CLI prompts interactively and alone receives the temporary `lighting_bootstrap` credential. HTTP runtime never receives it. |

A pure config function should accept an explicit env object for deterministic tests. backend/src/app.ts currently reads imported config.corsOrigin even when createApp(env) receives another env; production origin behavior must come from validated runtime configuration rather than implicit global config. `NOMINATIM_AUTO_GEOCODE=false` does not disable the explicit `geocode:points` CLI (`backend/src/scripts/geocodeLightPoints.ts` currently calls `runMigrations()` and the legacy Nominatim-backed path). This production release must not invoke or expose that CLI; automatic/CLI inventory enrichment remains OFF.

### 4.3 Secret/public boundary

- **Public/browser-visible:** CARTO key, tile style URL, public/admin origins, API base. CARTO key is not a secret; restrict by referrer to public map hostname only. Keep any localhost key separate.
- **Server secrets:** JWT_SECRET, Geoapify key, DB runtime/migration credentials, and TLS private key. Use host/container secret mechanism; never log env dumps, command lines, or full provider URLs.
- **One-shot bootstrap secret:** `lighting_bootstrap` credential is supplied only to the controlled server-side bootstrap invocation, absent from the normal HTTP environment and image, and disabled/revoked or removed from secret storage after successful bootstrap.
- **Infrastructure-only:** DNS/firewall, TLS cert files/renewal credentials, DB admin credentials. Not in source or public image.

.env.example and root Compose defaults are development examples only, not production templates.

## 5. Database and persistence security

### 5.1 Current state

Migrations 0001/0002 establish:

- light_points with canonical inventory id, PostGIS point geometry, active/inactive/maintenance state, address and address_geocoded_at;
- admins with unique username, password hash, is_active; no roles column;
- admin_refresh_sessions with token hash, expiry, revocation;
- import_batches and import_batch_rows with outcomes/history and a schema CHECK that clears payload for terminal outcomes;
- admin_activity_logs and inventory_audit_events;
- integration_logs with request/response JSONB, status, error and timestamps.

No citizen-report table/persistence exists. Do not add one in this foundation. Migrations live in backend/src/db/migrations; runner is backend/src/db/migrate.ts.

### 5.2 Minimum DB roles

**Recommend three narrowly scoped app capabilities**, plus separately managed DB administrator credentials not stored in the app container:

1. **lighting_migrator:** only controlled release/migration step. Owns or has necessary DDL authority for existing migration chain. May create/alter migration-owned objects; extension provisioning only if target PostgreSQL policy permits it. No HTTP process receives this credential.
2. **lighting_runtime:** DML privileges only for tables/sequences actually used. Build an evidence-based table/sequence matrix from SQL call sites, including auth, import queue, admin activity, inventory audit, reads and health. No ownership, schema/table CREATE, extension install, role/database creation, or superuser.
3. **lighting_bootstrap:** temporary one-shot login/capability used only by the first-admin CLI. Grant only the narrowly required advisory-lock function, column-level read needed to check whether `admins` is empty, INSERT on `admins` and `admin_activity_logs`, and USAGE on only the associated ID sequences if required by the schema. It receives no schema/DDL, ownership, role-management, extension, or superuser privileges. It is not granted to `lighting_runtime`; retire the login/secret after success.

Main process currently runs migrations at startup. Move migration to explicit one-shot release command using MIGRATION_DB_*; runtime uses DB_* only. At runtime verify DB and expected migration ledger/version with runtime role, then start worker/listener. Schema mismatch is startup error. No auto-migrate on every HTTP start.

Do not combine migration, runtime, and bootstrap privileges: HTTP compromise must not inherit DDL or first-admin creation capability. These three narrowly scoped capabilities are the minimum justified model for this single VM; no group-role hierarchy is needed. Provision PostGIS/pgcrypto with a DBA or approved migrator permissions; never solve extension privilege by giving runtime or bootstrap postgres/superuser access. PostgreSQL distinguishes ownership from grants and supports least privilege: [PostgreSQL privileges](https://www.postgresql.org/docs/current/ddl-priv.html).

No schema/migrations change in this planning checkpoint. If migration role cannot run current migration statements without a schema change, isolate that blocker rather than silently granting superuser.

### 5.3 Retention/recovery

Owner targets, not current proof:

- one year for import/history/audit/admin operational history;
- RPO 24h;
- RTO 4h.

No cleanup schedule, backup/restore automation, encryption-at-rest proof or recovery drill was found. Keep deletion/retention SQL, scheduled tasks, backup encryption/location/rotation, restore drill, and RPO/RTO evidence in separate DB-operations checkpoint. Ensure logs do not become unbounded second retention store. Database operations are deployment prerequisite, not part of this implementation foundation.

## 6. Backend/API, trust proxy and route boundary

### 6.1 Request flow

Current flow:

    request → Express proxy trust → CORS/cookie/body middleware → router → validation → domain/service → pg or provider → response/error handler

| Route group | Current behavior | Production exposure |
|---|---|---|
| GET /api/health | SELECT 1 and status JSON. | Both origins; no secret/detail; no-store. |
| /api/reports/address-suggestion | Public JSON POST; exact field/coordinate validation, service-area classification, in-memory IP/admission limits, then disabled/fake/Geoapify service. | Public host only; no raw body/coordinate/provider URL log; failures not success. |
| /api/light-points | Public inventory reads. | Public host only; retain bounds. |
| /api/admin/auth/* | Login, refresh, logout, me. Login has in-memory 20/15min limiter. | Admin host only; auth POST has CSRF/origin guard; /me remains authenticated/no-store. |
| /api/admin/street-lights/* | Protected CRUD, one-file import preview, confirm/history, export. | Admin host only; requireAdmin remains server boundary. |
| /api/admin/logs/* and integration settings | Protected admin history/config views. | Admin host only; no cache or secret/raw payload disclosure. |
| /api/dev/ausemio-test-submit | Gated local simulated sink. | Absent/unmounted in production even if stray flag exists. |
| /api/reports/send | No current real route. | Must remain absent; no alias/fallback/synthetic delivered success. |

Route source: backend/src/app.ts; protection: backend/src/routes/admin.routes.ts; auth: backend/src/routes/adminAuth.routes.ts; import: backend/src/routes/adminStreetLights.routes.ts; local sink: backend/src/routes/ausemioTest.routes.ts; address suggestion: backend/src/routes/reportAddressSuggestion.routes.ts. Keep service=2 VO only; do not add service=16 payload/mapping.

### 6.2 Proxy trust/client IP

One intended hop: browser → Nginx → Express. Backend trusts only Nginx exact internal address or dedicated narrow subnet in TRUST_PROXY_CIDRS. Nginx overwrites X-Forwarded-For from socket peer; it must not append client-supplied XFF. It sets X-Forwarded-Host from validated Host and X-Forwarded-Proto from TLS state. Backend validates Host/Origin against PUBLIC_ORIGIN and ADMIN_ORIGIN.

Test forged XFF, X-Real-IP, Forwarded, X-Forwarded-Host and X-Forwarded-Proto. req.ip and limiter bucket must reflect observed client, not supplied values. Verify external/host access to port 5000 fails. If CDN/load balancer added later, re-document every hop; never broaden trust without evidence.

### 6.3 CORS

Each browser calls its own origin /api, so production browser CORS is unnecessary. Disable Express CORS in production. Do not let public origin read credentialed admin API responses; no wildcard plus credentials. Future non-browser client is separate scoped decision.

## 7. Authentication, cookies and CSRF

### 7.1 Current evidence

Auth routes are backend/src/routes/adminAuth.routes.ts. JWT, hashed refresh session rotation/revocation and activity logs are in backend/src/services/auth.service.ts. Current cookies are access_token and refresh_token. Admin client uses credentials: include and refreshes once after 401: frontend/apps/admin/src/services/adminApi.ts.

### 7.2 Cookie policy

Production cookies: host-only (no Domain), Secure, HttpOnly, Path=/, SameSite=Lax. Prefer __Host- prefix for access and refresh names; it requires Secure, Path=/ and no Domain in supporting browsers. Change constants and clearing behavior together; test HTTPS-like requests. Keep current refresh lifetime/revocation unless separate finding says otherwise. Do not widen to Domain=.vra-ubuntu-server-0579.virtual.cloud.tuke.sk.

Test login flags, refresh rotation, logout clearing attributes, and cookie isolation between admin/public hosts. Synthetic credentials only.

### 7.3 CSRF recommendation for sibling subdomains

Approved hosts are different origins but share a registrable domain. SameSite=Lax alone does not separate sibling origins; credentialed CORS is not CSRF protection. OWASP calls for cautious sibling-origin treatment and Origin/Referer fallback if Fetch Metadata is absent: [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

**Recommended control:** apply a common guard to every unsafe cookie-auth admin action and auth POST: login, refresh, logout, CRUD, import preview/confirm, delete.

1. Require HTTPS in production.
2. If Sec-Fetch-Site is present, accept only same-origin for unsafe methods. Reject same-site, cross-site, none, or malformed values; public/admin are siblings, so same-site is insufficient.
3. Require Origin to parse exactly to admin HTTPS origin. If Origin is absent, require Referer with exact admin origin. If both are absent/invalid, fail closed.
4. State changes use POST/PUT/PATCH/DELETE, never GET.
5. Keep JSON/custom-header behavior. Do not add a CSRF token unless compatibility evidence shows exact-origin fallback insufficient. This avoids new user-visible flow; security design still gets independent review.

Tests: allow same-origin login/refresh/logout/import/CRUD; reject public sibling and cross-site; reject mismatched/forged Origin; valid Referer fallback; reject missing/invalid Origin and Referer. Origin checks protect browser ambient-cookie requests; they do not authenticate arbitrary non-browser callers. Keep requireAdmin and private backend access.

## 8. Secure first-admin bootstrap

Fresh migrations create no admin; development seed is not production provisioning. Implement a one-shot server-side CLI, not browser registration. The CLI receives the separate temporary `lighting_bootstrap` database credential; the normal HTTP process receives only `lighting_runtime` and cannot invoke or authenticate as the bootstrap capability:

- Run after migrations in a controlled server-side administration session; do not use the HTTP runtime credential.
- Read username/password with interactive no-echo TTY prompt. No default; password is never echoed, passed in command-line arguments, stored in files/source/container image, or written to logs.
- The repository has bcrypt hashing/verification for existing accounts but no supported admin-creation/password policy. Define and test explicit bootstrap input bounds; use the existing bcrypt library and do not claim an established creation policy.
- In one transaction acquire a dedicated PostgreSQL advisory lock, verify `admins` is empty, insert one active admin, and write a minimal `admin_activity_logs` event with `admin_id = NULL`, action identifying secure first-admin bootstrap, and no password/hash/secret. This is a system/bootstrap actor, not an invented pre-existing authenticated admin. The schema permits nullable `admin_id`; no schema change is needed to fabricate an actor. Audit failure rolls back both inserts.
- If any admin exists, exit nonzero without update/reactivation/reset. Concurrent invocation creates at most one.
- No public registration; no ADMIN_INITIAL_PASSWORD shortcut in production. The bootstrap credential exists only for the controlled invocation, is absent from the HTTP environment/image and is retired after success. A second invocation before retirement refuses without mutation.

Disposable migrated PostgreSQL tests: successful first bootstrap; no password in output; second run refuses without mutation; concurrent invocation creates at most one admin; the runtime credential cannot create an admin through the bootstrap mechanism; audit failure rolls back admin and event; normal backend startup never bootstraps. Verify grants directly and confirm `admin_id` is NULL on the bootstrap event.

## 9. CARTO production tiles

### 9.1 Current integration

frontend/apps/public/src/config/mapTiles.ts creates CARTO raster URLs for dark_all/light_all, has key query parameter and visible OSM+CARTO attribution. Key is browser-visible by design. Missing approval/key currently silently disables map, contrary to production-ON requirement.

### 9.2 Setup and tests

- Public production build requires VITE_MAP_TILE_PROVIDER=carto, VITE_CARTO_TILES_APPROVED=true, VITE_CARTO_PUBLIC_KEY. Missing/wrong values fail build.
- Supply key only to public build. Restrict by referrer to exact public map host; admin app does not need map unless active screen proves otherwise. Separate localhost/test key.
- Preserve CARTO and OpenStreetMap attribution in all themes/sizes.
- Verify intended commercial/noncommercial account class and plan/usage limits; repository cannot establish account terms.
- No CARTO key was requested, copied, validated or used.

External snapshot checked 2026-10-08: CARTO Basemaps page requires key in tile/style/glyph/sprite URLs and attribution; lists up to 5M monthly noncommercial and 1M commercial free allowance, paid plan above commercial allowance. Dashboard supports website Referrer restrictions. Not proof of account plan/legal approval: [CARTO key/pricing](https://carto.com/basemaps/apikey/), [terms](https://carto.com/legal/basemap-terms/), [key dashboard](https://dashboard.basemaps.carto.com/).

If production config absent, fail build; no public OSM/Nominatim or fake fallback. Tile outage is visible while preserving existing manual/no-map flow. Test via synthetic/local tile fulfillment: approved URL/styles, public key encoding, attribution, no provider fallback, no report-success state, and no egress outside test containment.

## 10. Geoapify production geocoding

### 10.1 Current integration/data boundary

The production Geoapify feature is the public/report address-suggestion route, `backend/src/routes/reportAddressSuggestion.routes.ts`. It accepts exact latitude, longitude, targetKind and language fields; validates ranges/service area; and calls injectable `reportAddressSuggestionService`. `backend/src/providers/geoapifyAddressProvider.ts` uses HTTPS GET to fixed EU origin `api-eu.geoapify.com`; the key is a server-to-provider URL parameter. The UI treats returned address as an editable suggestion. This path does not mutate inventory persistence, create citizen-report persistence, or submit to the municipality.

Automatic/CLI inventory/light-point enrichment is explicitly **OUT OF CURRENT PRODUCTION SCOPE** by owner decision. `backend/src/services/geocoding.service.ts` is a separate legacy inventory reverse-geocoder through Nominatim; keep it disabled, do not invoke its CLI in production, and never silently use public Nominatim. The inventory persistence race/no-op issue below is unrelated to the public address-suggestion route and does not block public Geoapify suggestions or CARTO.

### 10.2 Activation controls

- Production explicitly sets GEOAPIFY_ENABLED=true for public/report address suggestions only; inventory enrichment remains OFF.
- GEOAPIFY_API_KEY only in backend secret storage. Because it is an outbound URL parameter, never log full URL, request/response, key, coordinates, or stack traces containing URL. Log provider id, coarse status, duration and aggregate counters only.
- Retain HTTPS and allowlisted api-eu.geoapify.com. No arbitrary provider URL from environment.
- Preserve bounded timeout, active/pending concurrency, spacing, queue expiry, per-IP admission and daily budget. Verify cap against actual plan. Current daily budget is in process memory and resets after restart; it is a guardrail, not hard vendor quota. Verify account-side quota/billing controls before activation. If no adequate hard cap exists, agree spend ceiling first.
- Keep retries bounded/absent. Timeout, 429/quota, malformed response and 5xx are non-success suggestion states. Preserve typed address/manual entry. No Nominatim/other-provider fallback.
- Show required Geoapify/data-source attribution beside suggestion. Do not claim GDPR/legal approval from attribution. Before any live coordinate transfer, close the qualified privacy/legal review for processor terms, retention and user notice required by the existing P2c activation plan; provider selection does not satisfy that review.

External snapshot:
- Reverse geocoding is HTTP GET with coordinates/API key; server-side use and key restrictions are documented: [Reverse Geocoding API](https://apidocs.geoapify.com/docs/geocoding/reverse-geocoding/), [API keys](https://myprojects.geoapify.com/help/api-keys/).
- Current pricing lists 3,000 credits/day and up to 5 requests/second for Free and says commercial production use subject to limits/attribution. Separate Terms v5 (2024-02-02) says free commercial production has limitations/contact details, Free attribution is mandatory, and quota splitting across projects/accounts is prohibited. Do not state Free production is unconditionally guaranteed by Terms; verify actual account plan/terms without splitting: [Pricing](https://www.geoapify.com/pricing/), [Terms](https://www.geoapify.com/terms-and-conditions/), [attribution](https://www.geoapify.com/geocoding-api/).
- No live Geoapify request/key validation in planning or CI.

Fake transport tests: missing key/unsupported origin fail config; fixed hostname only; timeout/429/5xx/invalid response/queue full/budget/abort/disconnect normalize safely; logs/errors omit secret/coordinate/body/provider URL; outbound params contain only approved suggestion data; no AUSEMIO/Nominatim/live calls; provider failure preserves manual input and is not presented as successful report.

## 11. Future inventory geocoding enrichment hardening

This is **deferred and outside the current production-foundation release**. It is required only before automatic/CLI inventory/light-point enrichment is ever enabled in production. It does not block CARTO, public Geoapify address suggestions, or production-foundation implementation/merge: the public suggestion route does not mutate inventory persistence, and CARTO is independent of inventory geocoding.

### Current code defect/risk

backend/src/services/lightPoints.service.ts::ensureLightPointAddress snapshots coordinates/address, calls reverseGeocode outside transaction, then locks/rechecks row. It returns without setting address_geocoded_at when provider address equals current address. With NULL timestamp, future invocation can call provider again. It correctly skips stale result after coordinates/address change, but geocodePendingLightPoints increments “updated” after every resolved call, including no-op/stale skip. backend/src/services/geocoding.service.ts has process-global lastRequestAt/cache but no in-flight same-point coordination; delay is not cross-process quota control.

### Future correction and test boundary

If the owner later enables inventory enrichment, implement a localized persistence/concurrency checkpoint before that feature's activation:

1. Successful provider resolution is terminal for unchanged coordinate/address snapshot, including same text: persist address_geocoded_at success marker without fabricating address-change audit event.
2. Recheck coordinates/address under row lock before applying the result. If stale, do not persist result/marker for new coordinates and do not count it as an address update.
3. Distinguish changed, successful no-op, stale, failed outcomes; no “updated” increment for no-op/stale.
4. Serialize same-light-point enrichment across concurrent work using a session-level PostgreSQL advisory lock on a dedicated connection, or an equivalently proven durable claim. Bound lock acquisition by timeout and provider work by a deadline. Do not leave a DB transaction open across network I/O. Release the lock/claim in `finally` after success, timeout, cancellation, DB/provider failure; failure/timeout must permit a later retry.
5. Avoid duplicate upstream requests after successful concurrent winner; if chosen design cannot ensure this, revise the criterion with measured evidence before inventory enrichment enablement.
6. Avoid schema/migration unless a demonstrated blocker requires one; a required migration must be separately scoped and reviewed before implementation.
7. Nominatim remains off. Any future inventory provider use must use the approved Geoapify adapter or remain disabled.

Required disposable PostgreSQL/PostGIS barrier integration evidence before inventory enrichment activation:
- two workers same point, same provider address, NULL timestamp: one upstream request, final marker, correct single outcome;
- second call after successful same-address result makes no provider request;
- coordinates changed during fetch: stale result not applied/count as update;
- simultaneous updates show claim ordering/no deadlock/long transaction;
- timeout/error releases claim for later attempt;
- repeated migration idempotency only if schema migration added; otherwise test existing migrated disposable DB.
- fake transport only.

This future inventory-enrichment checkpoint must receive targeted independent review before inventory enrichment is enabled. It is not a prerequisite for current-scope public Geoapify address suggestions, CARTO, or production-foundation merge/implementation.

## 12. Provider failures and product behavior

- Missing mandatory CARTO config is release/config failure, not silent fallback.
- CARTO outage shows provider unavailable; retain manual target/address path; no OSM or alternate tiles.
- Geoapify timeout/quota/malformed/transient failure gives safe unavailable suggestion, preserves user text, allows manual address entry, never claims municipal delivery.
- No public Nominatim fallback, hidden /api/reports/send, or AUSEMIO interaction.
- Test existing manual location/address continuations.
- If owner expects hard block rather than manual continuation during total CARTO failure, code does not establish that user-visible policy. Recommended behavior is manual continuation consistent with existing fallback; request confirmation only if changing behavior.

## 13. Production health/startup smoke acceptance

Synthetic-only, no live provider calls:

1. Public/admin hosts serve their own index/assets.
2. Each deep link resolves to its own SPA; wrong host never serves other app.
3. /api/health through both hosts returns bounded status; API failures never return SPA HTML.
4. /api/admin/* denied on public; admin writes remain requireAdmin + CSRF protected.
5. External/host access to backend:5000 and PostgreSQL:5432 fails; Nginx reaches backend; backend reaches DB.
6. Runtime role cannot create/alter schema/table/install extension; migration role runs migrations and is absent from HTTP environment.
7. Proxy spoof tests prove untrusted headers cannot change req.ip/scheme/host/limiter/cookie decisions.
8. HTTPS-like tests prove Secure/HttpOnly/host-only cookies, rotation, logout, origin validation.
9. First-admin CLI works on fresh disposable DB, cannot reset existing admin, no credential in logs.
10. Production static image has no Vite server; public build requires approved CARTO values and attribution.
11. Public Geoapify config validates without network; unit/provider tests inject fake transport. Any provider-facing browser/integration path that could otherwise contact an external service runs only under process-egress containment; see the evidence scope in section 15.
12. Local sink absent in production even if flag set; /api/reports/send absent.
13. CI evidence is scoped: `process-egress-research` proves containment for its contained synthetic workload; `browser-e2e` runs under that containment. Ordinary `frontend` and `backend` jobs are not globally network-contained, and their success is not proof that arbitrary PR-controlled tests cannot make external requests. For the tested provider paths, injected fake transports and contained-browser request-ledger/egress evidence must show no live CARTO, Geoapify, Nominatim, or AUSEMIO traffic.

This is release-foundation validation, not resource benchmark, backup/restore drill, legal review or deployment.

## 14. Runtime dependency security snapshot

### 14.1 Current lock evidence

Read-only npm audit against committed locks on 2026-10-08:

| Lock tree | Full audit | npm audit --omit=dev | Relevant locked runtime packages |
|---|---|---|---|
| frontend | 13: 6 moderate, 5 high, 2 critical | 2 moderate, 0 high, 0 critical | react-router-dom/react-router 6.30.4 |
| backend | 12: 6 moderate, 3 high, 3 critical | 6: 3 moderate, 2 high, 1 critical | multer 2.1.1; express 4.22.2; proxy-addr 2.0.7; ip-address 10.2.0; body-parser 1.20.5; qs 6.15.2 |

Date-specific registry snapshot, not proof of zero risk. CI dependency-audit-report remains informational; green does not mean zero findings.

npm explain verified paths:
- frontend react-router-dom → react-router is production.
- backend Multer is direct dependency used by authenticated admin import route.
- Express → proxy-addr supports Express client IP/trust proxy; express-rate-limit → ip-address is in limiter dependency graph.
- Express → body-parser and qs are runtime parsers.
- Vite/Vitest and vulnerable transitive packages are devDependencies, not shipped production runtime.

### 14.2 Targeted runtime remediation before Internet exposure

Do not upgrade unrelated majors or run npm audit fix blindly. Update only vulnerable runtime dependency graph and lock it:

| Package | Current | Target indicated by current advisory/registry snapshot | Evidence |
|---|---:|---:|---|
| multer | 2.1.1 | at least 2.3.0; registry latest checked 2.4.0 | Advisory ranges include <2.3.0. Authenticated import passes; malformed/deep field names and aborted uploads do not exhaust resources. |
| proxy-addr | 2.0.7 | 2.0.8 | Affected <2.0.8; spoofed XFF/Express req.ip tests. |
| ip-address | 10.2.0 | >10.7.0; 10.7.1 exists outside checked affected range, latest checked 10.7.3 | Boundary/rate-limit tests pass without trust-policy change. |
| express | 4.22.2 | 4.22.3 compatible patch exists | Re-run API/auth/import; resolve patched body-parser/qs/proxy-addr transitives. |
| react-router/react-router-dom | 6.30.4 | Upgrade to at least 7.18.0 for GHSA-wrjc-x8rr-h8h6; this is a targeted security major upgrade, not general modernization. | Route/deep-link/login-return and hostile redirect regression below; stay on v7. |

Re-query advisory DB/release notes before implementation and choose versions that clear current affected ranges. Do not select only because registry latest.

Multer uses memoryStorage, fileSize 5 MiB, and route .single('file'), but limits only file size. After patched release, set explicit bounds for one-file contract: files=1, fields=0, parts=1, finite field-name/header limits, fileSize=5 MiB. Frontend sends one file part; reconfirm before fields=0. Proxy cap 6 MiB permits multipart framing; over-limit request returns deterministic 413 without fallback.

React Router is production runtime and requires a targeted v7 security upgrade before Internet exposure; a v6 patch alone does not close the relevant GHSA-wrjc range. This is a targeted security major upgrade, not broad dependency modernization. Before selecting the implementation version, recheck authoritative advisories/releases and pin a patched `react-router` plus `react-router-dom` version at or above 7.18.0. Do not bundle Vite/Vitest major upgrades merely to reduce report counts; they are dev-only and are not shipped in the production static image.

Authoritative advisory snapshot checked 2026-10-08:

- [GHSA-wrjc-x8rr-h8h6](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6): `react-router` >=6.0.0 and <7.18.0 is affected; patched in 7.18.0. This follow-up concerns attacker-supplied paths passed to navigation mechanisms. The locked 6.30.4 line, including 6.30.6, remains inside the affected range.
- [GHSA-jjmj-jmhj-qwj2](https://github.com/advisories/GHSA-jjmj-jmhj-qwj2): `react-router-dom` >=6.30.2 through 6.30.5 is affected, patched in 6.30.6; `react-router` >=7.9.6 through 7.12.0 is affected, patched in 7.13.0. Thus 6.30.6 fixes this advisory but not GHSA-wrjc.
- [GHSA-337j-9hxr-rhxg](https://github.com/advisories/GHSA-337j-9hxr-rhxg): `react-router` >=6.4.0 and <7.18.0 is listed as affected, patched in 7.18.0. The advisory explicitly says Declarative Mode applications are not impacted; current public/admin entry points use `BrowserRouter` and declarative `<Routes>` and do not use SSR/hydration. Record as not applicable to the current mode, not as a reason to claim the broader v6 range is safe.
- Official [React Router 7.18.0 release](https://github.com/remix-run/react-router/releases/tag/react-router@7.18.0) and npm metadata confirm the `react-router-dom@7.18.0` package exists, depends on `react-router@7.18.0`, and declares Node >=20 / React >=18. This makes the targeted v7 path compatible with the declared runtime floor, subject to the required app regression tests.

The current admin return-navigation surface is `AdminProtectedRoute` storing `location.pathname` in `state.from`, then `AdminLoginPage` passing that value to `navigate`. This is a potentially relevant attacker-influenced navigation path, not a confirmed exploit finding. The targeted v7 upgrade must include route regression tests, login/return-navigation tests, public/admin deep-link tests, hostile `//`, backslash and encoded redirect-input tests, both production builds, and contained browser E2E. Do not substitute an unverified v6 workaround.

Relevant advisory details:
- Multer high findings include multipart field-name/array-index denial-of-service and cleanup/size issues.
- proxy-addr critical GHSA-jqcg-44mw-7w3h affects <2.0.8 (IPv4-mapped IPv6 trusted-subnet spoofing).
- ip-address GHSA-j6r3-76f7-8jcv affects <=10.7.0 (cross-family subnet comparison), plus affected-version parsing/bounds advisories.
- React Router is locked to 6.30.4; GHSA-jjmj affects that version, and GHSA-wrjc remains applicable to the entire v6 line below 7.18.0. GHSA-337j is SSR/hydration-specific and not applicable to this app's Declarative Mode entry points.
References: [proxy-addr](https://github.com/advisories/GHSA-jqcg-44mw-7w3h), [ip-address](https://github.com/advisories/GHSA-j6r3-76f7-8jcv), [Multer](https://github.com/advisories/GHSA-wc9g-mqfw-jrwm), [GHSA-wrjc](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6), [GHSA-jjmj](https://github.com/advisories/GHSA-jjmj-jmhj-qwj2), [GHSA-337j](https://github.com/advisories/GHSA-337j-9hxr-rhxg). Keep audit reports as implementation evidence; do not call findings fixed before validation.

## 15. CI and acceptance evidence

Preserve exact existing workflow job names and containment:
- frontend
- backend
- process-egress-research
- browser-e2e
- dependency-audit-report
- sqlfluff-report

Add evidence inside these jobs unless separate required check clearly needed and approved. Do not rename jobs or weaken branch protection/egress.

- **frontend:** separate production builds; missing CARTO config fails; no localhost API URL; static artifact/deep-link/API routing smoke; unit/component tests use fake/injected provider transports and must not intentionally call CARTO, Geoapify, Nominatim or AUSEMIO. This ordinary job is not globally process-egress-contained.
- **backend:** production config matrix; runtime/migration/bootstrap DB privilege check on disposable PostGIS; CSRF/cookie/proxy spoof; fake Geoapify transport. This ordinary job is not globally process-egress-contained; green status alone does not prove network blocking.
- **process-egress-research:** prove privilege-resistant network containment for the synthetic probe workload only; do not generalize it to other jobs.
- **browser-e2e:** depends on successful process-egress-research and runs the browser workload inside containment; use synthetic tiles/provider and record request-ledger plus egress evidence.
- **Provider evidence:** classify by test path. Fake-transport tests prove behavior without upstream dispatch; contained browser/integration runs use request-ledger and containment evidence to show no live provider/AUSEMIO traffic for those paths. No existing job proves a blanket no-egress property for all PR-controlled frontend/backend tests.
- **dependency-audit-report/sqlfluff-report:** remain informational. Add blocking production-only audit checks in frontend/backend after runtime remediation; dev-only Vite/Vitest remain informational pending separate compatible update.
- Informational green jobs do not mean no findings.

## 16. Implementation sequence and checkpoint boundary

Implementation is not authorized by this plan. Once separately approved, use one coherent production-foundation implementation PR for interdependent static/proxy/config/auth/bootstrap/provider/CI work. The owner-resolved current geocoding scope is public Geoapify address suggestions only; inventory enrichment stays OFF, so its separate persistence/race hardening is not on the production-foundation critical path.

| Order | Phase | Scope / exit evidence | Dependency |
|---:|---|---|---|
| A | Static serving + private network | Production artifacts, Nginx host/API routing, separate roots, no exposed backend/DB ports, cache/upload/proxy limits; synthetic container smoke. | First. |
| B | Fail-closed config + secrets + DB roles + proxy trust | Required vars; separate migration/runtime/bootstrap credentials; explicit migration step; exact proxy trust; req.ip/spoof tests. | A. |
| C | Cookie/CORS/CSRF | Host-only Secure cookies, exact Origin/Referer + Fetch Metadata, host separation, tests. | B. |
| D | First-admin bootstrap | No-echo CLI with separate `lighting_bootstrap` credential, transaction/advisory lock, NULL-actor audit event, refusal/no-overwrite/concurrency/grant tests. | B. |
| E | Targeted runtime dependencies | Multer, Express transitive graph, proxy-addr, ip-address, targeted React Router 7.18.0+ security upgrade and required regressions; production-only npm audit gate. | Before Internet exposure; can proceed with A-D. |
| F | CARTO production config | Required public build config/key referrer/attribution, synthetic tile test, fail-closed build. | A/E; operations confirms account plan. Independent of inventory enrichment. |
| G | Public Geoapify address-suggestion config | Required server key/fixed EU host/quotas/attribution/failure behavior/fake transport; live transfer waits for account/spend and privacy/legal gates. | B/C/E; does not depend on inventory race hardening. |
| H | Integrated CI/release evidence | Preserve job names and containment scopes; validate topology, grants, CSRF/bootstrap/providers, fake transports and contained browser request-ledger; exact-head CI. | A-G. |

Inventory geocoding enrichment hardening is a separate future checkpoint only if the owner later enables automatic/CLI inventory enrichment. It is required before that future feature is activated, but does not block F, G, H, production-foundation implementation or its merge.

## 17. Deferred checkpoints and explicit unknowns

### Deferred work

**Database operations:** scheduled backups, encrypted/off-host storage, restore drill, prove RPO 24h/RTO 4h, one-year retention cleanup, monitoring/alerts, owners and volume sizing. These remain required before full production approval after foundation implementation.

**Target resource validation:** benchmark selected Ubuntu 24.04/2-vCPU/4-GB/250-GB host; measure CPU/RSS/disk/latency with representative imports/exports; verify headroom for PostgreSQL, Node and proxy. This remains required before full production approval after foundation implementation.

**Future inventory geocoding enrichment hardening:** retain the Section 11 no-op/stale/count/race analysis; implement its PostgreSQL lock/claim correction and barrier-controlled cross-process tests only if inventory enrichment is later enabled. It is not part of this production release.

**Other deferred P2/tooling:** broad TS alias cleanup; direct imported-row E2E assertion; Windows service-area line-ending/hash portability; generic SQLFluff cleanup and large-seed lint coverage; unrelated dependency majors; general max inventory/export row limits unless proxy/security requires; Vite/Vitest majors beyond production runtime.

AUSEMIO/P4, public submission, service 16/CSS and live provider requests are out of scope.

### Owner/infra gates

Already final and not reopened: topology A, hosts, target VM, CARTO, Geoapify, tiles/geocoding ON, AUSEMIO HOLD, one-year history, RPO 24h, RTO 4h, service 2 only/service 16 out.

Remaining operational/legal gates for production activation:

1. **Geoapify plan/spend/account restriction:** provider chosen, but repo cannot establish account, quota, hard spend cap, or applicable contract. Operations supplies plan constraint before key enablement. Do not split accounts/projects.
2. **CARTO account class/quota:** provider chosen, account classification and actual quota unknown. Operations confirms before key use.
3. **Qualified privacy/legal review:** the canonical P2c location-activation plan requires review of coordinate transfer, processor terms, retention and user notice before live Geoapify activation. This does not reopen provider selection.
4. **TLS/DNS/firewall owner:** hostnames final; DNS records/certificate lifecycle/firewall are not repo facts. Infra owner supplies before deployment.
5. **All-tiles outage:** existing manual fallback suggests continue manually. Confirm only if changing user-visible policy to block form.
6. **Inventory enrichment remains OFF:** no open scope decision for this release. If owner later enables automatic/CLI inventory enrichment, create the separate Section 11 checkpoint before activation; until then do not invoke the legacy Nominatim path.

These do not reopen the approved product/provider choices. Account, privacy/legal and infrastructure gates must close before live provider use/deployment. Database-operations and target-resource evidence remain separate requirements before full production approval. Inventory enrichment remains excluded and its future race checkpoint is not a current blocker.

## 18. Plan acceptance checklist

Ready for targeted independent re-audit because the corrections:

- distinguishes repo-confirmed, owner-provided, external-doc, proposed and unknown facts;
- uses exact approved hosts/topology A;
- keeps backend/DB private;
- replaces Vite production serving with independent static artifacts;
- recommends Nginx proxy/header/body/cache behavior;
- requires fail-closed config, secret separation, migration/runtime/bootstrap capabilities;
- specifies host-only cookies and sibling-subdomain CSRF protection;
- defines secure first-admin bootstrap with a separate least-privilege credential and NULL system actor;
- specifies CARTO/Geoapify without live calls or unapproved fallback;
- keeps public Geoapify suggestions and CARTO independent of deferred inventory geocoding hardening;
- records retention/RPO/RTO while deferring operational implementation;
- preserves exact CI job names and accurately scopes process-egress evidence;
- records the external owner-supplied readiness-audit provenance and summary without claiming source reconstruction;
- records inventory race hardening as required only before future inventory enrichment;
- makes no implementation/deployment change.

The PR must be documentation-only. Targeted independent plan re-audit is the next gate; it does not authorize implementation.

## 19. Research references

**Repository evidence**
- [Development/research roadmap](../development-research-plan.md)
- [P5 implementation checkpoint](p5-implementation.md)
- [P2c location activation plan](p2c-location-activation-implementation-plan.md)
- [P2c privacy evidence](../security-privacy/p2c-geolocation-privacy-evidence.md)

**Official external references checked 2026-10-08**
- [GitHub Advisory GHSA-wrjc-x8rr-h8h6](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6)
- [GitHub Advisory GHSA-jjmj-jmhj-qwj2](https://github.com/advisories/GHSA-jjmj-jmhj-qwj2)
- [GitHub Advisory GHSA-337j-9hxr-rhxg](https://github.com/advisories/GHSA-337j-9hxr-rhxg)
- [React Router v7.18.0 release](https://github.com/remix-run/react-router/releases/tag/react-router@7.18.0)
- [react-router-dom 7.18.0 package metadata](https://www.npmjs.com/package/react-router-dom/v/7.18.0)
- [Nginx core HTTP module](https://nginx.org/en/docs/http/ngx_http_core_module.html)
- [Nginx proxy HTTP module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)
- [Caddy SPA/API patterns](https://caddyserver.com/docs/caddyfile/patterns)
- [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https)
- [Docker Compose networking](https://docs.docker.com/compose/how-tos/networking/)
- [PostgreSQL privileges](https://www.postgresql.org/docs/current/ddl-priv.html)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [CARTO Basemaps key/pricing](https://carto.com/basemaps/apikey/)
- [CARTO Basemaps terms](https://carto.com/legal/basemap-terms/)
- [Geoapify reverse API](https://apidocs.geoapify.com/docs/geocoding/reverse-geocoding/)
- [Geoapify API keys](https://myprojects.geoapify.com/help/api-keys/)
- [Geoapify pricing](https://www.geoapify.com/pricing/)
- [Geoapify Terms v5](https://www.geoapify.com/terms-and-conditions/)
- [Geoapify attribution](https://www.geoapify.com/geocoding-api/)

No live CARTO, Geoapify, Nominatim, AUSEMIO, DNS, or TLS endpoint was requested or contacted.
