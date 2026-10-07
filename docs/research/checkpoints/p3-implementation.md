# P3 — Implementation checkpoint

**Status:** PR #20 is open and unmerged on `feature/p3-postgis-import-persistence`. Independent result audit of historical audited head `f94d7f3758c7245f34e6e46e91df429aa52ae587` returned **FAIL** (P0=0, P1=5, P2=6). The five targeted P1 corrections below are implemented; corrected-head CI evidence is reported in the final handoff, and targeted independent re-audit remains pending.
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
| P3 disposable PostgreSQL/PostGIS migration, persistence/import, and ordinary export suites | Migrations 9/9 passed; persistence/import 10/10 passed; export 2 passed and 1 opt-in resource test skipped |
| 100,000-row PostgreSQL export resource test | PASS; observations and hardware limitation below |
| Development seed on dedicated `p3_seed_test` database | PASS: 255 rows, 255 distinct IDs, zero non-null `external_id`, zero null geometries; observed IDs 14–289 |
| Seed conversion against base SQL | PASS: parsed 255 source rows; every internal ID, inventory value, latitude, and longitude matches the base seed exactly |
| Compiled Docker migration smoke | PASS: both SQL assets found/applied and PostGIS reported |
| Frontend test-source typecheck, tests, build | PASS: 196 tests across 23 files; build emits the existing >500 kB chunk warning |
| Full backend suite with P3 and P2c PostgreSQL integration enabled | 160 passed, 5 failed, 1 skipped. The failures are the known Windows service-area hash mismatch: three dependent address-suggestion API cases, report-target PostgreSQL integration, and committed service-area artifact classification. P3 migration/persistence/export tests passed. |
| P2c PostgreSQL report-target integration | Fails locally with `service_area_unavailable` because the Windows checkout does not match the committed service-area artifact hashes; Linux CI is the authoritative cross-platform check. |
| Service-area `--check` and compiled service-area smoke | Both fail locally. `core.autocrlf=true`; working source subset is 367,988 bytes / SHA-256 `3f226cfb1bc4032a1d479166778b4a67978fbfae50a2a77754e8092c5ee9a4ca`, while the source manifest expects `b1cc7cbc2c38ea6a2eabbf3972c88e57c7e46671bdc98eaed67c4498cb1dd277` (the committed Git blob is 367,987 bytes and matches that expected hash). Working output GeoJSON SHA-256 is `34ae9ef4adac37821931c9f39d0a07d70011a295ff4f6b527b7f330aa8c63952`, while its manifest expects `69080f2d913fe7167888a4231ef949381046868ef21fc3645dbd19c908026b26` (the committed Git blob is 212,841 bytes and matches that expected hash). The canonical boundary/artifact was not changed. |
| Browser E2E / process-egress containment | Not run locally. The repository requires the Linux privilege-resistant namespace wrapper; the `PROCESS_EGRESS_ISOLATED` flag was not bypassed. Remote PR CI remains the required evidence. |

## Historical remote PR validation evidence

The original implementation snapshot at `3b45cd987fab41d117a1fcb23f8ad2ba99aa0e62` passed run [37640860466](https://github.com/krustallik/public-lighting-fault-reporting/actions/runs/37640860466). The later evidence-only snapshot at `f94d7f3758c7245f34e6e46e91df429aa52ae587` passed run `37641720665`. Those runs predate the targeted P1 corrections and are historical evidence only. Independent result audit of the latter snapshot returned **FAIL** (P0=0, P1=5, P2=6); neither run establishes corrected-head validation. The current exact-head CI outcome is recorded in the final handoff to avoid a self-referential commit/head update loop.

## Independent result audit and targeted P1 corrections

The audit findings were: migration checksums depended on checkout line endings; legacy adoption could leave a partial migration ledger; fresh migration performed DDL before the UTF8 check; CSV parsing discarded single-field `#` source rows; and geocoding could mutate inventory without an atomic audit or make a committed create/update appear failed. The correction adds:

- `backend/src/db/migrationChecksum.ts` canonicalizes CRLF and lone CR to LF before SHA-256. `migrationChecksum.test.ts` verifies line-ending equivalence and real SQL-change detection; compiled migration smoke compares packaged and source migrations through the same helper.
- Legacy adoption now creates the ledger and stamps baseline `0001` in one transaction under the migration advisory lock. Real PostgreSQL tests inject a ledger-create failure and prove retry, inject a later migration failure and prove baseline recovery, and race two adoption calls to verify one consistent winner.
- A shared UTF8 prerequisite runs under the migration lock before ledger/schema inspection or DDL and is reused by the recognized-schema/data preflight. A real LATIN1 database test verifies startup fails before creating the ledger or application tables.
- CSV parsing retains `#` rows; malformed rows remain failed import evidence with unchanged source numbering, while quoted `#` values parse as ordinary data. Unit tests and the persisted import-preview integration test cover this.
- Geocoding performs its provider request before opening a transaction, then locks/rechecks the row, compares final values, and atomically writes the address plus an audit event. Background and maintenance events use explicit `system:automatic-geocoding` / `system:maintenance-geocoding` actors with no fabricated admin ID. Optional automatic-provider failures after primary create/update are logged with a fixed safe message and do not turn the committed operation into an API failure. Fake-provider PostgreSQL tests cover success, failure, rollback, no-op behavior, background audit, and zero import geocoder calls.

The audit's six P2 findings are not declared closed by these changes. The documented resource-profile gap, unbounded individual row size, Windows service-area portability, dependency findings, and SQLFluff findings remain non-blocking limitations.

The 100,000-row synthetic export observed `chunkRows=250`, `outputChunkChars=8192`, 32,441,713 output bytes, 29,054 ms export time, 1,116,607 bytes/s, and RSS from 59,535,360 to 103,243,776 bytes (delta 43,708,416). A client pause was exercised, all 100,000 rows completed, and the PostgreSQL client was returned. These are observations on a Windows host and an unbounded local PostgreSQL container, **not** validation of the plan's Ubuntu 24.04 / 2-vCPU / 4-GB target profile or a performance SLA.

## Remaining accepted P2

Maximum individual inventory/export row size remains unspecified. The migrated schema leaves `inventory_number`, `address`, `district`, and related text fields unbounded (`TEXT`); the 5 MiB import-file cap bounds one uploaded file, not historical database rows or the size of a single exported field. `express.json()` is installed without an explicit project-specific limit, and export writes strings in slices but `pg` still materializes each selected row before serialization. The checked-in 255-row seed has inventory numbers up to 3 characters and no address values, so it does not establish a production-sized maximum. No new user-visible field limit was invented. Closing this P2 requires a representative accepted data boundary and a measured one-row memory budget or an owner-approved limit.

## Dependency and safety evidence

- No package dependency or lockfile changed. Backend package changes are build/database scripts only.
- Historical PR audit artifacts report frontend: 13 findings (6 moderate, 5 high, 2 critical) and backend: 12 findings (6 moderate, 3 high, 3 critical). Base run `37629267332` reported the same counts for both packages. These are nonzero findings, not a clean audit. The targeted correction changes no dependencies or lockfiles. The historical informational SQLFluff report had linter exit code 1 with rule findings; a green report-collection job is not evidence of a clean lint result.
- No AUSEMIO access/write and no live CARTO, Geoapify, or Nominatim requests were made. Product scope remains lighting inventory and service `2` / VO only; service `16` / CSS is out of scope. No live provider activation, Redis, P5 admin deployment, report-send route, duplicate-history persistence, or schema migration for citizen reports was introduced.

## Publication and audit status

The implementation has not been merged. Local corrected-code validation is recorded above; the exact corrected-head CI outcome is in the final handoff, and targeted independent result re-audit remains pending. The independent plan verdict was `PASS WITH P2` (P0=0, P1=0); that plan audit is not an implementation audit. No P2 is claimed closed by this correction.
