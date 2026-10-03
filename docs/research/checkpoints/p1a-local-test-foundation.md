# P1a Local Test Foundation Checkpoint

**Status:** P1a local foundation implemented and validated; ready for independent audit
**Date:** 2026-10-03
**Scope:** reusable local automated-test foundation and characterization tests only. No production behavior changes. This local phase does not activate CI; P1b remains gated on the CI provider/infrastructure decision and demonstrated mandatory checks.

## Context and current state

- The repository has two independent npm packages and lockfiles; there is no root workspace/package manifest (`frontend/package.json`, `backend/package.json`, respective `package-lock.json`).
- Frontend: React 18, TypeScript 5.6, Vite 5.4.21 (`frontend/package.json`, `frontend/package-lock.json`); current build script is `tsc -b && vite build`.
- Backend: Express 4, TypeScript 5.6, `tsx` (`backend/package.json`); current build script is `tsc`.
- Both Dockerfiles use `node:20-alpine` (`frontend/Dockerfile`, `backend/Dockerfile`). Current local Node is 22.14.0. Repository package manifests do not declare an engines range.
- Before this checkpoint there were no automated test files, test scripts, or lint scripts. Existing npm dependencies are installed in both app directories. The project conventions use npm lockfiles and Docker build commands.
- The repository's Compose database uses `postgres:16-alpine` plus a persistent named volume (`docker-compose.yml`), so it is not treated as disposable test infrastructure. P1a pure/helper tests did not need a database. The user-designated disposable PostgreSQL 16 workflow was not discoverable/usable from this sandbox: Docker CLI could not connect to the Docker API (permission denied). Any future real PostgreSQL integration suite must use that disposable workflow; mocks here do not count as DB verification.

## Testability seams and limits

| Area | Existing deterministic seam | P1a scope / limitation |
|---|---|---|
| Report body mapping | `frontend/src/utils/buildReportFormData.ts::buildReportFormData` | Can inspect multipart keys, defaults, trimmed values, locale, omitted app-only values, and repeated files using synthetic inputs. Does not validate AUSEMIO server acceptance. |
| Frontend validators | `frontend/src/schemas/reportSchema.ts` | Zod schemas can be called with synthetic values; no React rendering/DOM environment needed for these schema tests. |
| Phone rules | `frontend/src/utils/slovakPhone.ts`, `backend/src/utils/slovakPhone.ts` | Pure functions; characterize each copy independently and check expected overlap without refactoring/merging. |
| Local AUSEMIO mapping/parsing | `backend/src/config/ausemioMapping.ts`, `backend/src/config/ausemioFormOptions.ts`, `backend/src/utils/parseAusemioMultipartBody.ts` | Constants, validators, technical-log mapper, nested/flat multipart parser are deterministic; they represent current local behavior, including any external-contract drift recorded in `../ausemio/contract-audit.md`. |
| Import parsing/sorting | `backend/src/services/streetLightsImport.service.ts::parseImportBuffer`, `frontend/src/utils/sortImportPreviewRows.ts` | Parser can be called with synthetic buffers and no database query. Do not test confirm/transaction/retry/duplicate policy until the P3 owner-decision gate. |
| CSV serialization | `backend/src/services/streetLightsExport.service.ts::exportStreetLights` | Export service is coupled to `pool`; mock only the DB query result and characterize returned CSV serialization. Do not refactor private `escapeCsv` just to expose it. |
| Database, API, UI and browser | DB-backed services/routes, React components, browser app | Deferred layers. Future PostgreSQL integration must use the owner-approved disposable PostgreSQL 16 workflow; mocks are not a replacement for that verification. No test-only production refactor is justified yet. |

## Candidate tooling and selection

| Candidate | Advantages in this repository | Trade-offs / reason not selected |
|---|---|---|
| Vitest 3.2.7 + `@vitest/coverage-v8` 3.2.7 per npm app | TypeScript transform and Vite config/alias integration for frontend; Node environment also supports backend source; same runner/report model in both separately locked apps; V8 coverage reports line, branch, and function counts. Version supports existing Vite 5 and Node 20 Docker base. | Adds development dependencies to each app; backend also needs a Vite 5 peer/dev dependency. Does not itself create DOM, real PostgreSQL, HTTP, or browser tests. |
| Node built-in `node:test` + `tsx` + a coverage collector | Low framework overhead; backend already has `tsx`; native Node test API. | Frontend does not currently have `tsx`; frontend source uses the `@/` alias and Vite module configuration, so native Node tests would need extra loader/alias handling. Coverage would need a separate collector. It gives a less uniform config across the existing packages. |
| Jest + TypeScript transform | Mature broad ecosystem and familiar mock APIs. | Adds a second transform/config path alongside Vite and TypeScript; no existing Jest setup. More infrastructure than required for deterministic helper tests. |
| Playwright/component/browser runner | Appropriate for browser journey and DOM behavior. | Too broad for the first pure/helper baseline; not needed for the current unit targets and does not replace API/PostgreSQL integration coverage. |

**Selected:** Vitest `3.2.7` plus matching `@vitest/coverage-v8` `3.2.7` in both `frontend/` and `backend/`; use the existing frontend Vite 5 line and pin backend test-time Vite to 5.4.21 to satisfy the runner's Vite peer requirement without changing application configuration. Use Node environment, isolated per-app configs, npm scripts, and V8 coverage with text/LCOV/HTML reports. Coverage is informational in P1a; no threshold is introduced.

**Rationale/evidence:** the official [Vitest v3 getting-started guide](https://v3.vitest.dev/guide/) states Vitest v3 requires Vite >=5 and Node >=18 and reads Vite configuration; the official [Vitest v3 coverage guide](https://v3.vitest.dev/guide/coverage/) documents the V8 provider and `@vitest/coverage-v8`. The current Vitest guide reports Vitest 5 requires Vite >=6.4 and Node >=22.12, which conflicts with this repo's Vite 5.4 and Node 20 Docker base ([current guide](https://vitest.dev/guide/)).

**Thesis Writing dependency:** not required for this engineering compatibility/tooling choice. Consult before any later thesis claim that relies on academic or standards-based testing methodology; P7 only transfers verified evidence.

## Test organization and coverage contract

- Keep each app independently installable/testable according to its existing npm lockfile.
- Place first characterization tests under each package's `tests/unit/`; configs/scripts remain in their owning package. Keep future API/service, PostgreSQL/migration, component, browser/E2E, regression/security layers separable by path/config.
- Run tests once in scripts (not watch mode), and provide a separate coverage script. Coverage scope must include current `src/**/*.{ts,tsx}` so untested production modules remain visible, while the output/summary explicitly distinguishes the narrow P1a helper tests from full critical-behavior coverage.
- Emit text summary plus LCOV and HTML reports. Ignore generated report/cache folders rather than committing generated output.
- No tests may require real AUSEMIO traffic, real personal data, an owner session, or a production write. External adapter scenarios remain mock-only.

| Future test layer | Reusable shape | P1a status |
|---|---|---|
| Unit | Vitest per app; deterministic fixtures; no external services | Implemented for selected pure/helper behavior |
| Backend/service | Vitest service tests with explicit fake DB/external seams | One CSV export case uses mocked `pool.query`; report/auth/geocoder service cases remain future work |
| API integration | Isolated Express app + HTTP test client, then route/controller/middleware assertions | Deferred; select API client when that layer starts, no extra dependency added now |
| Real PostgreSQL integration | Disposable PostgreSQL 16 workflow; real schema/data constraints; never substitute mocks for this layer | Deferred; Docker API inaccessible from current sandbox and P1a contains no DB-dependent tests |
| Migrations/constraints | Real PostgreSQL 16 clean bootstrap/upgrade/constraint tests against approved migration policy | Deferred with P3 migration-source/rollback decisions |
| Frontend/component | Vitest plus DOM environment only if rendering behavior is in scope | Deferred; no DOM environment dependency installed |
| Browser/E2E | Browser runner against local frontend/API/test DB, with external writes blocked | Deferred; not needed for helper foundation |
| Regression/security | Reproducer test for a separately accepted bug/security finding; keep external calls mocked | Framework available, no issue fixes or security scan performed here |

## Acceptance criteria

1. Frontend and backend test dependencies/config/scripts install and execute from their own npm package roots using npm lockfiles.
2. Initial tests characterize existing helper behavior and pass without modifying production code to make them pass.
3. If a characterization test reveals a current defect, stop that behavior's expansion and record a separate finding; do not repair it in P1a.
4. Coverage command emits line, branch, and function summaries and persistent LCOV/HTML reports for the configured source scope; report actual coverage and uncovered critical risks without setting a 100% goal or misleading target.
5. A controlled red-on-failure check demonstrates the runner fails for a failing assertion, then leaves the repository test suite green and no intentional failing test behind.
6. Existing frontend/backend build/typecheck commands pass; no production runtime source, schema/migration, or application behavior is changed.
7. Diff/status are reviewed; generated coverage/cache files and local secrets are not committed.

## Tests to create first (characterize, do not repair)

Initial order and expected behaviors to pin from current code:

1. **Frontend phone helper:** trimming/separator removal, `00` prefix normalization, accepted Slovak forms, blank optional value, and E.164 formatting (`frontend/src/utils/slovakPhone.ts`).
2. **Backend phone helper:** same current cases against the independent backend implementation (`backend/src/utils/slovakPhone.ts`).
3. **Frontend report mapper:** fixed VO service, trimming, default location/fault codes, locale, optional phone representation, repeated file field, and excluded app-only consent/light-point data (`frontend/src/utils/buildReportFormData.ts`).
4. **Frontend report schemas:** required location/email/consent, optional phone, and current file maximum using synthetic data (`frontend/src/schemas/reportSchema.ts`).
5. **Backend local mapping/parser:** flat and nested multipart inputs, defaults, accepted current local codes, and technical-log field projection (`backend/src/utils/parseAusemioMultipartBody.ts`, `backend/src/config/ausemioMapping.ts`, `backend/src/config/ausemioFormOptions.ts`).
6. **Import parser / preview row sorting:** minimal well-formed CSV, JSON and GeoJSON inputs plus stable sort criteria; characterize parsing, not decisions about import atomicity, identity, retries, concurrency or audit semantics (`backend/src/services/streetLightsImport.service.ts`, `frontend/src/utils/sortImportPreviewRows.ts`).
7. **CSV export:** mock only `pool.query`, then assert current header, selected serialization/escaping and format metadata (`backend/src/services/streetLightsExport.service.ts`).

Expected outputs must be written in tests only after inspecting the current implementation. Tests use synthetic values and do not redefine AUSEMIO's server contract. If current behavior contradicts external evidence, retain and report the mismatch rather than making the test green through a production change.

## Risks, limits and non-goals

- P1a is not CI activation. No significant behavior-changing implementation is authorized until P1b has an evidenced provider decision and mandatory checks are demonstrated red-on-failure and green-on-success.
- Test coverage is not equivalent to critical business-flow coverage. Initial helper tests do not exercise auth/session rotation, real PostgreSQL constraints/migrations, HTTP upload limits, route authorization, browser accessibility, or external response semantics.
- Import tests are characterization only until the P3 owner-decision gate is satisfied.
- Coverage reports can be low or uneven because the whole `src/` tree is in scope but only selected pure paths are initially exercised. No arbitrary percentage target.
- If test coverage reveals a need to expose private behavior or refactor production modules, record a proposed follow-up; do not refactor as a convenience in this checkpoint.
- npm may need registry access for clean dependency installation. If the environment cannot resolve/install packages, preserve package/lock consistency and report the exact limitation instead of substituting a different package manager/lockfile.

## Execution record

| Step | Result / evidence |
|---|---|
| Baseline review and tool choice before dependency installation | Done; see current state, alternatives, and official compatibility evidence above. |
| Test runner/coverage dependencies and configs | Installed `vitest@3.2.7` and matching `@vitest/coverage-v8@3.2.7` in both apps. Backend also has dev-only `vite@5.4.21` to satisfy the Vite peer at the same Vite line as the frontend lockfile. Added `test`, `coverage`, and `typecheck:tests` scripts; per-app `vitest.config.ts` and `tsconfig.test.json`; root ignores for generated `coverage/` and `.vitest/`. npm lock versions for previously locked packages did not change; new package graph entries were added. |
| Characterization tests | 22 tests added: frontend 11 across 4 files, backend 11 across 4 files. All use synthetic/local inputs; CSV export mocks only `pool.query`; no test opens external network traffic or a real DB. |
| Green suite and controlled red-on-failure demonstration | Both `npm run test` commands passed 11/11. A temporary synthetic failing assertion produced exit code 1; its probe file was removed in `finally`. Both suites were rerun afterward and passed 11/11; no failing probe remains. |
| Coverage result and uncovered-risk summary | Both `npm run coverage` commands passed and produced text, LCOV, and HTML reports. Frontend: line 11.54%, branch 43.15%, function 30.13%. Backend: line 16.72%, branch 54.00%, function 32.55%. Generated reports are ignored, not committed. |
| Frontend/backend build/typecheck | Both `npm run typecheck:tests` and existing `npm run build` passed in each app. Frontend Vite build emitted its existing-size warning: a minified chunk is 501.17 kB (>500 kB); build still succeeded. |
| Git diff/publication | Pending final staging/commit/push. Current branch is `master` tracking `origin/master`; no new branch or PR policy has been introduced. |
| Independent audit | Pending |

### Added test files and current coverage meaning

- Frontend: `frontend/tests/unit/slovakPhone.test.ts`, `reportSchema.test.ts`, `buildReportFormData.test.ts`, `sortImportPreviewRows.test.ts`.
- Backend: `backend/tests/unit/slovakPhone.test.ts`, `ausemioMapping.test.ts`, `importParsing.test.ts`, `streetLightsExport.test.ts`.
- Coverage figures use all `src/**/*.{ts,tsx}` as the configured denominator. The relatively low line totals honestly show that tests currently exercise a few helpers, not broad application behavior. Function and branch ratios also must not be described as critical-flow coverage.
- Covered behavior includes current form-data defaults/key construction; selected Zod validation; independent frontend/backend Slovak phone helpers; local AUSEMIO field parser/options/technical-log projection; simple CSV/JSON/GeoJSON import parsing; preview sorting; and CSV export escaping with a fake database query.
- Still uncovered/high-risk: report HTTP validation/upload and simulated response path; external adapter/server contract; auth/JWT refresh-session rotation and authorization; PostgreSQL constraints/migrations; import confirm transactions, duplicate/retry/concurrency semantics; most route/controller/service error paths; React rendered/component behavior, accessibility, and browser journeys.
- npm install printed registry audit summaries: frontend 11 findings (4 high, 7 moderate), backend 10 (3 high, 7 moderate), and a deprecation warning for transitive `glob@10.5.0`. These are install-time summaries, not an independently captured `npm audit` report. No audit fix/update command was run. Treat the changed counts and transitive warning as a separate security/dependency triage item; do not silently include remediation in P1a.

## Traceability

| Requirement / acceptance criterion | Test(s) | Implementation / result | Validation evidence | Independent audit outcome | Thesis-evidence reference |
|---|---|---|---|---|---|
| Reusable local runner in both npm packages | `npm run test` in `frontend/` and `backend/` | Vitest 3.2.7, per-package config/scripts/lockfiles | Both suites 11/11 green | Pending | Not transferred |
| Test-first characterization of existing helper behavior | Eight `tests/unit/*.test.ts` files, 22 assertions/tests total | Helpers characterized without production edits; import tests avoid unresolved import-policy semantics | Final local rerun: frontend 11/11, backend 11/11 | Pending | Not transferred |
| Coverage reports line/branch/function and uncovered risks | `npm run coverage` in both apps | V8 coverage; text/LCOV/HTML output ignored by Git | Front 11.54/43.15/30.13% line/branch/function; backend 16.72/54.00/32.55%; risk list above | Pending | Not transferred |
| Red-on-failure then green; no intentional failure remains | One-off failing frontend assertion, then both normal suites rerun | Probe removed in `finally`; no permanent red test | Expected exit 1 on injected failure; subsequent frontend/backend suites exit 0; probe path absent | Pending | Not transferred |
| Existing builds/typechecks pass; production behavior unchanged | `typecheck:tests` and existing `build` per app | Only test/dev tooling, tests, docs, lockfiles, and generated-output ignore rules changed | All four typecheck/build commands exit 0; frontend bundle-size warning recorded | Pending | Not transferred |
| P2 mapping and mock-only matrix, no live adapter/write | See `../ausemio/contract-audit.md` | Formal field matrix and fake-transport test scenarios documented | Prior GET-only evidence; no new AUSEMIO browser/write request | Pending | Not transferred |

**Checkpoint result:** P1a local test foundation and P2 client mapping/test matrix are ready for independent audit. P1b CI activation remains separate and unresolved; no significant behavior-changing implementation is unblocked by this local checkpoint alone.
