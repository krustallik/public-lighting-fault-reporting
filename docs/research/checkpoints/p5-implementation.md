# P5 — Public/Admin Frontend Separation Implementation

**Status:** implementation code head `b119235fcdec61b7116b46930d10df1b01e3d365` passed exact-head CI and contained browser/PostGIS validation in run `37754243317`. PR #22 remains open and unmerged; ready for independent result audit.
**Canonical plan:** `docs/research/checkpoints/p5-public-admin-separation-plan.md` (approved and merged before this implementation).
**Base:** `master` at `aebf3353e3b765a773f9b29b05e3436518904fa9`.
**Implementation branch:** `feature/p5-public-admin-separation`.

## Scope and decisions preserved

This checkpoint records the topology-neutral separation of the public and admin frontend applications in the existing repository. The Express API, P3 PostgreSQL/PostGIS schema and migrations, inventory/import/export behavior, auth/session contracts, dependencies, and dependency lockfiles are not intentionally changed. No production hostname, origin, proxy, deployment cadence, cookie, CORS, or CSRF decision is made here. The development Vite `/api` proxy is local-development behavior only.

No AUSEMIO, live geocoder, or live tile-provider request was made. No production integration or credential was added. Existing public simulated-result behavior and server-side `requireAdmin` authorization remain the application boundaries.

## Implemented application boundaries

| Application | Entry and router | Source ownership | Build output |
|---|---|---|---|
| Public | `frontend/apps/public/index.html`, `src/main.tsx`, `src/App.tsx` | Map-first/report/result, public services, locality data, localization, map components | `frontend/dist/public` |
| Admin | `frontend/apps/admin/index.html`, `src/main.tsx`, `src/App.tsx` | Admin auth/session, login, inventory, import/history, export, settings, logs | `frontend/dist/admin` |
| Shared | `frontend/shared/LightPointStatus.ts` | The only shared app contract: `LightPointStatus`, imported by active public and admin types | Included in both builds |

Each app has an independent Vite config, HTML entry, React root, router tree, TypeScript project, and build command. `VITE_ADMIN_BASE_PATH` remains configurable and defaults to `/panel-svietidla`; the route structure is owned by the admin application. Public `main.tsx` does not mount `AdminAuthProvider` and imports no admin client/pages/router. `AdminAuthProvider` is mounted only by the admin entry. The public router has no admin route or redirect. The formerly unmounted `AdminLightPointsPage` remains under `frontend/legacy/` and is not imported into either app.

The build-boundary plugin at `frontend/scripts/assert-frontend-module-graph.mjs` inspects Vite's actual module graph and fails the build if the public graph contains admin app modules or if the admin graph contains public app modules or Leaflet packages. The observed local production build reported:

- Public: 144 modules, 52 public app-owned modules, forbidden admin graph absent.
- Admin: 71 modules, 26 admin app-owned modules, forbidden public graph and Leaflet packages absent.

`frontend/scripts/check-app-build-boundaries.mjs` builds both applications. Aggregate frontend scripts cover both app typechecks, test-source typecheck, tests, coverage, and builds. `frontend/tests/e2e/application-separation.spec.ts` adds a contained browser assertion that public startup does not request `/api/admin/auth/me` or contact the admin dev origin. It passed in the exact-head contained browser run recorded below; local browser E2E was unavailable on this Windows host.

## Admin browser E2E and disposable PostGIS setup

`frontend/tests/e2e/admin-app.spec.ts` exercises admin login, `/me`, HTTP-only session cookies, an unauthenticated protected endpoint, protected deep navigation, inventory list/detail, import preview/confirmation/status/history, export, and logout against the real Express application. It uses a deterministic synthetic admin, inventory row, and import file; it does not mock client auth.

`backend/tests/e2e-support/prepareDatabase.ts` requires test mode, explicit `P5_E2E_ALLOW_DB_RESET=true`, an absolute Unix-socket directory, and a database name matching `p5_e2e_*`. It creates/uses only that disposable database, runs the canonical migration chain, verifies PostGIS and migrations `0001,0002`, truncates its tables, and seeds synthetic records. `backend/tests/e2e-support/server.ts` verifies that same migration/PostGIS state before starting the real Express app and import worker. `cleanupDatabase.ts` clears synthetic rows after the test. The GitHub `browser-e2e` job mounts the disposable PostGIS Unix socket into the workspace and passes that path into the already-contained workload; it does not expose database TCP or broaden the isolated network. Exact-head CI confirms this setup and the real contained browser run; details follow.

## Local validation evidence

Validation was performed on Windows from this branch before remote CI:

| Check | Result |
|---|---|
| Frontend `npm ci` | Passed; no dependency/lockfile change. npm reported 13 audit findings (6 moderate, 5 high, 2 critical); this informational install output is not a zero-vulnerability result. |
| Frontend typecheck | Passed for public app, admin app, and test sources. |
| Frontend unit/component suite | Passed: 24 files, 200 tests. |
| Frontend coverage | Passed: 24 files, 200 tests; aggregate statements/lines 83.09%, branches 84.04%, functions 74.75%. |
| Frontend production builds and module graph checks | Passed for both outputs with the module counts recorded above. Public build emitted Vite's existing >500 kB chunk-size advisory. |
| Backend test-source typecheck | Passed, including the new E2E support sources. |
| Backend build | Passed; packaged the two service-area runtime assets and two migration assets. |
| Backend unit/integration suite | Not fully green locally: 139 passed, 23 PostgreSQL integration tests skipped, and 4 failed. The failures were 3 address-suggestion API cases and 1 service-area artifact case; the classifier reported `unavailable`. |
| Service-area generator `--check` | Failed locally with `Source provenance manifest or committed source checksum is invalid`. This is the already documented Windows line-ending/hash portability P2; canonical geodata/assets were not changed. |
| Local PostgreSQL/PostGIS and browser E2E | Not run: Docker CLI is installed but the Docker Desktop Linux engine is unavailable in this environment, and no local PostgreSQL service/client was found. |
| Exact-head GitHub CI / process-egress browser containment | Passed on final code head `b119235fcdec61b7116b46930d10df1b01e3d365`; see the remote evidence below. |

The backend failures are recorded rather than hidden or repaired in this frontend-separation task. The three address-suggestion failures share the unavailable service-area classifier condition. The four failures and skipped database integration checks require interpretation alongside the Linux CI run; no P3 persistence or service-area behavior was changed to mask them.

## Exact-head remote validation

GitHub Actions run [`37754243317`](https://github.com/krustallik/public-lighting-fault-reporting/actions/runs/37754243317) validated code head `b119235fcdec61b7116b46930d10df1b01e3d365` on 2026-10-08. All jobs completed successfully: `frontend`, `backend`, `process-egress-research`, `browser-e2e`, `dependency-audit-report`, and `sqlfluff-report`.

- The frontend job passed both app typechecks, test-source typecheck, unit/component tests, coverage, and both builds. The build-graph check reported public 144 modules / 52 app-owned modules with the forbidden admin graph absent, and admin 71 modules / 26 app-owned modules with the forbidden public/Leaflet graph absent.
- The browser job prepared disposable database `p5_e2e_admin`, applied migrations `0001,0002`, verified PostGIS and synthetic admin/inventory rows, then started the real Express E2E server inside the contained workload. Playwright reported 28 tests passed, including the real admin auth/import/history/export scenario and public startup without admin auth bootstrap. Database cleanup completed.
- The process-egress proof passed before the browser suite: host namespace reassociation was blocked, the workload had loopback only and empty IPv4/IPv6 routes, and the privilege-dropped processes ran with no effective capabilities and `no_new_privs=1`.
- The informational npm report artifact records frontend 13 findings (6 moderate, 5 high, 2 critical) and backend 12 (6 moderate, 3 high, 3 critical). No dependency or lockfile versions changed in this PR, so no new dependency versions were introduced; a green report job does not mean zero findings.
- The SQLFluff report artifact contains 225 finding rows and an informational exit code of 1; its green report job does not mean the findings are zero.

Two earlier CI attempts exposed and then resolved test-harness issues before this final run. Run `37753219553` failed because the Postgres socket bind-mount source lived inside the checkout and checkout cleanup could not unlink it (`EACCES`). The host socket was moved to a per-run `/tmp` path while retaining an empty workspace mountpoint for the contained bind mount. Run `37753667956` then passed containment and 27 of 28 browser tests; the remaining admin test failed because an exact-name `Import` locator matched both the header link and page link. The final test scopes that action to the header navigation, after which all 28 tests passed. Neither correction weakened network containment or changed application behavior.

PR #22 remains open and unmerged. No independent implementation result audit has been performed; this checkpoint records implementation evidence only.

## P3, security, and deployment boundaries

- No P3 SQL schema, migration, import/export implementation, application database configuration, or persistent business logic was changed.
- The only backend source change is under `backend/tests/e2e-support/`; it wires disposable migrated PostgreSQL/PostGIS into the test-only server and starts/stops the existing import worker for real admin E2E.
- The existing `frontend` and `backend` job names remain unchanged. `process-egress-research`, `dependency-audit-report`, and `sqlfluff-report` remain in the workflow. Browser E2E remains dependent on successful process-egress research and uses the existing privilege-resistant contained workload.
- Separate origins/hostnames, production routing, DNS/TLS, deployment ownership, cookie scope, CORS topology, and the required CSRF security evidence remain unresolved gates. Local ports 5173/5174 are development ports and prove no cookie-host isolation.
- No dependencies, package lockfiles, database schema, or migrations were changed. The local backend `npm ci` reported 12 audit findings (6 moderate, 3 high, 3 critical); findings remain informational and were not triaged as part of P5.

## Carried-forward non-blocking P3 P2 items

1. Ubuntu 24.04 / 2-vCPU / 4-GB resource validation.
2. Unbounded maximum individual inventory/export row size.
3. Windows service-area line-ending/hash portability.
4. npm audit vulnerabilities/findings.
5. SQLFluff findings and the large seed lint-coverage gap.
6. Geocoding no-op/race hardening and dedicated race-barrier tests.

These remain outside P5 scope. No P0/P1 finding has been independently assessed in this implementation checkpoint; this is not an independent result audit. Record remote CI results and any evidence-backed correction here before requesting that audit.
