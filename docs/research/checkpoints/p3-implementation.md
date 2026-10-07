# P3 — Implementation checkpoint

**Status:** implementation draft on `feature/p3-postgis-import-persistence`; remote PR/CI and independent result audit are pending.
**Base:** `master` at `d72e928487884cd758677d07b4222e979bf479b3`.
**Canonical contract:** [P3 PostgreSQL/PostGIS, Import/Export, Persistence and Queueing Implementation Plan](p3-postgres-import-export-implementation-plan.md).
**Scope:** public-lighting inventory persistence, inventory audit, durable imports, admin import history, and streaming exports. No report-send route or citizen-report persistence was added.

## Implemented state

- One ordered migration chain lives in `backend/src/db/migrations/`; `backend/src/db/migrate.ts` records migration version/name/SHA-256, serializes runners with an advisory lock, verifies applied checksums, and refuses unknown schema states. The read-only adoption preflight is in `backend/src/db/migrationPreflight.ts`; the startup path awaits migrations before listening in `backend/src/index.ts`.
- `0002_p3_postgis_inventory.sql` enables PostGIS and replaces writable scalar coordinates with `geom geometry(Point,4326)`, coordinate bounds/type checks and a GiST index. Public coordinates are derived from geometry; `GET /api/light-points?bbox=...` uses the viewport query in `backend/src/services/lightPoints.service.ts`.
- `inventory_number` is the canonical unique business identity; `external_id` is nullable, independent, and may repeat. TypeScript canonicalization is in `backend/src/domain/inventoryIdentity.ts`; PostgreSQL independently enforces its canonical value. Existing seeded IDs and coordinates are retained, with no fabricated external IDs.
- Create/update/delete inventory mutations and audit rows share explicit PostgreSQL transactions in `backend/src/db/transaction.ts` and `backend/src/services/lightPoints.service.ts`.
- `backend/src/services/streetLightsImport.service.ts` parses CSV/JSON/GeoJSON while preserving source rows, invalid rows and explicit field presence. Preview and staged normalized payload are persisted in PostgreSQL; raw upload bytes are not. Terminal row payloads are purged. Duplicate rows are grouped by canonical inventory number before processing; confirmation uses a per-import `allowUpdate` choice defaulted by the UI to off.
- `backend/src/services/importQueueWorker.service.ts` processes FIFO PostgreSQL batches sequentially using a session advisory lock, batch lease/token, and one transaction per mutating row for inventory, audit event, row result and counters. Expired processing leases are reclaimable; committed rows are not replayed. Queue recovery after a real child-process termination is covered by `backend/tests/integration/p3Persistence.postgres.test.ts`.
- Admin upload/preview/confirmation and history are surfaced in `frontend/src/pages/AdminImportPage/AdminImportPage.tsx`, `frontend/src/pages/AdminLogsPage/AdminLogsPage.tsx`, `frontend/src/services/adminApi.ts`, and `backend/src/controllers/adminStreetLights.controller.ts`.
- `backend/src/services/streetLightsExport.service.ts` streams CSV, JSON and GeoJSON from a repeatable-read snapshot in 250-row keyset chunks, with an 8,192-character output slice, backpressure handling and client/DB cleanup.
- Compose and CI use the pinned PostgreSQL 16/PostGIS 3.5 image. SQL migration assets are copied into compiled `dist/db/migrations/` by `backend/scripts/copy-db-assets.mjs`.

## Local verification evidence (Windows checkout)

| Check | Result |
|---|---|
| Backend test-source typecheck and build | PASS |
| P3 disposable PostgreSQL/PostGIS migrations + persistence + ordinary export suites | 11 passed; 1 resource test skipped by its opt-in flag |
| 100,000-row PostgreSQL export resource test | PASS; observations and hardware limitation below |
| Development seed on dedicated `p3_seed_test` database | PASS: 255 rows, 255 distinct IDs, zero non-null `external_id`, zero null geometries; observed IDs 14–289 |
| Seed conversion against base SQL | PASS: parsed 255 source rows; every internal ID, inventory value, latitude, and longitude matches the base seed exactly |
| Compiled Docker migration smoke | PASS: both SQL assets found/applied and PostGIS reported |
| Frontend test-source typecheck, tests, build | PASS: 196 tests across 23 files; build emits the existing >500 kB chunk warning |
| Full backend suite with P3 PostgreSQL tests enabled | 147 passed, 4 failed, 2 skipped. The four failures are in P2c service-area-dependent cases (`reportAddressSuggestionApi` x3 and committed service-area artifact x1); they fail closed as `service_area_unavailable` on this Windows checkout. The P3 migration/persistence/export cases passed. |
| P2c PostgreSQL report-target integration | FAILS locally with `service_area_unavailable` for the same artifact issue; not treated as a P3 regression result |
| Service-area `--check` and compiled service-area smoke | FAIL locally because the checked-out source/output bytes do not match their committed SHA-256 manifests. `core.autocrlf=true`; working source subset is 367,988 bytes / SHA-256 `3f226cfb1bc4032a1d479166778b4a67978fbfae50a2a77754e8092c5ee9a4ca`, while its manifest expects `b1cc7cbc2c38ea6a2eabbf3972c88e57c7e46671bdc98eaed67c4498cb1dd277`; the committed Git blob matches the expected value. Working output GeoJSON is SHA-256 `34ae9ef4adac37821931c9f39d0a07d70011a295ff4f6b527b7f330aa8c63952`, while its manifest expects `69080f2d913fe7167888a4231ef949381046868ef21fc3645dbd19c908026b26`; the committed Git blob matches that expected hash. The canonical boundary/artifact was not changed. |
| Browser E2E / process-egress containment | Not run locally. The repository requires the Linux privilege-resistant namespace wrapper; the `PROCESS_EGRESS_ISOLATED` flag was not bypassed. Remote PR CI remains the required evidence. |

The 100,000-row synthetic export observed `chunkRows=250`, `outputChunkChars=8192`, 32,441,713 output bytes, 29,054 ms export time, 1,116,607 bytes/s, and RSS from 59,535,360 to 103,243,776 bytes (delta 43,708,416). A client pause was exercised, all 100,000 rows completed, and the PostgreSQL client was returned. These are observations on a Windows host and an unbounded local PostgreSQL container, **not** validation of the plan's Ubuntu 24.04 / 2-vCPU / 4-GB target profile or a performance SLA.

## Remaining accepted P2

Maximum individual inventory/export row size remains unspecified. The migrated schema leaves `inventory_number`, `address`, `district`, and related text fields unbounded (`TEXT`); the 5 MiB import-file cap bounds one uploaded file, not historical database rows or the size of a single exported field. `express.json()` is installed without an explicit project-specific limit, and export writes strings in slices but `pg` still materializes each selected row before serialization. The checked-in 255-row seed has inventory numbers up to 3 characters and no address values, so it does not establish a production-sized maximum. No new user-visible field limit was invented. Closing this P2 requires a representative accepted data boundary and a measured one-row memory budget or an owner-approved limit.

## Dependency and safety evidence

- No package dependency or lockfile changed. Backend package changes are build/database scripts only.
- Local `npm audit` reported frontend: 13 findings (6 moderate, 5 high, 2 critical); backend: 12 findings (6 moderate, 3 high, 3 critical). The P3 change does not add or upgrade a dependency; these counts are not evidence of zero vulnerabilities. Remote informational audit artifacts must be reviewed independently.
- No AUSEMIO access/write and no live CARTO, Geoapify, or Nominatim requests were made. Product scope remains lighting inventory and service `2` / VO only; service `16` / CSS is out of scope. No live provider activation, Redis, P5 admin deployment, report-send route, duplicate-history persistence, or schema migration for citizen reports was introduced.

## Publication and audit status

At this checkpoint draft, the implementation has not been merged. Exact-head GitHub CI, remote browser E2E/process-egress evidence, and independent implementation result audit must be recorded here before describing the P3 implementation as ready for that audit. The independent plan verdict was `PASS WITH P2` (P0=0, P1=0); that plan audit is not an implementation audit.
