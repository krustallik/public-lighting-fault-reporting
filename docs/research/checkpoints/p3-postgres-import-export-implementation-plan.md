# P3 — PostgreSQL/PostGIS, Import/Export, Persistence and Queueing Implementation Plan

**Repository baseline:** `master` / `23a32febfb41b4dd5369d4d32055824f88cd8ccc`
**Checkpoint status:** Owner decisions incorporated — ready for independent plan audit
**Mode:** Planning only. No application, test, dependency, schema, migration, CI, or runtime files are changed by this checkpoint.
**Product scope:** Public lighting inventory; import/export and admin persistence. AUSEMIO/service `2` report integration, service `16`/CSS, and live map/geocoder providers are outside this checkpoint.

## 1. Purpose and evidence labels

This document is the implementation plan for P3. It distinguishes repository facts from target recommendations and unresolved product choices:

- **CONFIRMED — repository:** behavior visible in the current tracked source at the baseline above.
- **OWNER FIXED:** product behavior explicitly fixed in the P3 request; implementation must preserve it.
- **PROPOSED — engineering:** a concrete design recommendation for implementation, not evidence of existing behavior.
- **OWNER DECISION REQUIRED:** a product/data-retention choice not fixed by the current owner instructions. The P3 import decisions listed in this plan are now fixed; no P3 owner gate remains open.
- **UNKNOWN:** cannot be established from tracked repository contents. In particular, the live contents of any developer or hosted PostgreSQL volume were not queried.

## 2. Executive summary

P3 should replace the current loose coupling between the admin-facing `inventoryNumber` and `light_points.external_id` with an explicit, string-valued `inventory_number` business key. PostgreSQL must enforce its uniqueness; `external_id` remains independent nullable metadata and may repeat. The point geometry becomes the single coordinate source of truth using PostGIS `geometry(Point, 4326)`, with latitude/longitude derived at API boundaries.

Imports become durable, sequential PostgreSQL jobs. A job stores a bounded, allowlisted row representation only while processing, commits each row and its audit event atomically, preserves a safe per-row result for later inspection, and can resume pending rows after a process restart. Re-uploading data must not duplicate inventory. One invalid row must not undo successful rows.

The migration chain becomes the only schema source of truth, with a version/checksum ledger and transactional apply-once behavior. The current migrations are duplicated, lack a version ledger, and are not reliably packaged at the compiled runtime path. Export formats become views of one canonical inventory contract: CSV, JSON, and GeoJSON, with the current search/status/district filters applied to all matching rows rather than only the current admin table page.

The owner has now fixed inventory-number normalization, same-file duplicate handling, update-checkbox semantics, and current pre-production evidence retention. The plan below treats those as final product behavior. No P3 owner decision remains unresolved; unknown live DB contents still require a read-only migration preflight before any data migration.

## 3. Verified current state

### 3.1 Inventory model and data

**CONFIRMED — repository:**

- `database/schema.sql` defines `light_points.id SERIAL PRIMARY KEY`, nullable `external_id VARCHAR(50)`, scalar `latitude DECIMAL(10,8)` and `longitude DECIMAL(11,8)`, address/geocode metadata, district, lamp type, a checked status (`active`, `inactive`, `maintenance`), and timestamps. It has status and scalar-coordinate B-tree indexes. It has no PostGIS geometry and no uniqueness constraint for `external_id`.
- `backend/src/types/lightPoint.ts` exposes `external_id`, latitude, and longitude; `frontend/src/types/lightPoint.ts::mapLightPointFromApi` maps `external_id` to the public `inventory_number` field. `frontend/src/types/admin.ts::mapAdminStreetLight` maps it to `inventoryNumber`.
- Admin create/update in `backend/src/controllers/adminStreetLights.controller.ts` maps `inventoryNumber` to `external_id`. `backend/src/services/adminStreetLights.service.ts` searches/sorts `external_id`; `backend/src/services/lightPoints.service.ts` persists it.
- `backend/src/services/streetLightsImport.service.ts::mapRawRow` accepts `inventoryNumber`, `inventory_number`, `external_id`, `externalId`, and `inventory`; `resolveExisting` looks up `light_points.external_id`. The import identity therefore is currently the external ID column despite the UI describing it as an inventory number.
- `database/seed.sql` contains 255 point rows. Static parsing of the checked-in seed found 255 distinct `external_id` strings, all digit-only and 1–3 characters long, with no duplicates, empty values, leading/trailing whitespace, or leading zeroes. The three checked-in examples in `database/import-examples/` use the values as `inventoryNumber` strings. These are repository seed/fixture facts, not proof about a live PostgreSQL volume or every city source file.
- The CSV fixture header is `inventoryNumber,latitude,longitude,address,district,lampType,status`; the JSON and GeoJSON examples also use `inventoryNumber`; GeoJSON uses `[longitude, latitude]` coordinates. The repository does not provide a representative sample that resolves case, Unicode, whitespace, or leading-zero identity semantics.
- **UNKNOWN:** Current runtime database contents, whether any local/hosted DB volume has been seeded or edited, and inventory-number edge cases in a real authoritative source file are not determined from the repository. Do not run a data rewrite based only on the seed analysis.

### 3.2 Import behavior

**CONFIRMED — repository:**

- `backend/src/middleware/upload.ts` uses Multer memory storage with a 5 MiB file-size limit and accepts CSV/JSON/GeoJSON content types or extensions.
- The parser in `backend/src/services/streetLightsImport.service.ts::parseImportBuffer` supports JSON arrays/objects and GeoJSON FeatureCollections. Its CSV parser splits on commas/newlines and strips quotes; it is not a complete quoted-field CSV parser. `mapRawRow` filters malformed records out, so original source row numbers and invalid rows are lost before preview. `totalRows` is based on the remaining mapped rows.
- `buildImportPreview` performs serial per-row lookups and holds previews in a process-local `Map` with a 15-minute TTL. A restart loses previews. It does not detect duplicate identities within a file.
- `confirmImport` re-queries rows by `external_id`, then calls `createLightPoint` or `updateLightPoint` in a loop. `allowUpdate=false` skips existing rows. Exceptions are caught per row, but failure reasons are discarded. The batch header is inserted only after row mutations, and its history has no per-row results.
- Each `pool.query` in the current persistence services is an independent autocommit statement. `createLightPoint` inserts first and then calls `ensureLightPointAddress`; `updateLightPoint` performs several separate queries. When geocoding is enabled, those helpers can invoke the reverse-geocoder. A later failure can therefore count a row as failed after a prior DB mutation committed.
- `import_batches` in `database/schema.sql` stores filename, uploader, counters, and `created_at` only. `backend/src/controllers/adminLogs.controller.ts` and `backend/src/services/streetLightsImport.service.ts::listImportBatches` return limited batch headers; there is no persisted row-detail endpoint.
- Current parser tests are in `backend/tests/unit/importParsing.test.ts`; they cover basic CSV, one JSON alias, and GeoJSON coordinate order. They do not cover confirm transactions, identity uniqueness, retries, queue behavior, malformed-row retention, or import history.

### 3.3 Export, CRUD, and audit behavior

**CONFIRMED — repository:**

- `backend/src/services/streetLightsExport.service.ts::exportStreetLights` accepts `csv`, `json`, and `geojson`. It applies search/status/district filters and exports all matching DB rows without pagination, ordered by `id`. It searches `external_id`, address, and district; the admin listing additionally allows exact `id` search.
- The current CSV contains `inventoryNumber,latitude,longitude,address,district,lampType,status`; JSON includes `id`, the mapped inventory number, fields, and timestamps; GeoJSON uses a Point `[longitude, latitude]`, but omits timestamps and `external_id`. Thus the formats are not field-consistent. `escapeCsv` handles comma, quote, and LF but not CR. `backend/tests/unit/streetLightsExport.test.ts` has one mocked-query CSV serialization test; it does not exercise a real DB or JSON/GeoJSON.
- Admin routes are protected by `requireAdmin` in `backend/src/routes/admin.routes.ts`; `backend/src/routes/adminStreetLights.routes.ts` defines CRUD, import preview/confirm, and export endpoints.
- `backend/src/controllers/adminStreetLights.controller.ts` calls `logAdminActivity` after create/update/delete. Create/update/delete audit details are `{}` and are written through a separate pool query after the inventory mutation. A log failure therefore cannot roll back the already committed change. Import logs also record preview/summary metadata after the relevant work, not row-level mutation evidence.
- `admin_activity_logs` is a generic technical activity table used for auth/admin activity too. Its `details JSONB` does not currently enforce an inventory audit shape.

### 3.4 Migrations, initialization, and current test DB

**CONFIRMED — repository:**

- `docker-compose.yml` starts `postgres:16-alpine`, mounts `database/schema.sql` and `database/seed.sql` into the Postgres first-initialization directory, and persists data in `pgdata`. Docker entrypoint init scripts run only for an empty data directory; re-running Compose does not replay them into an existing volume.
- `backend/src/db/migrate.ts::runMigrations` first runs an inline `ALTER TABLE ... ADD COLUMN IF NOT EXISTS address_geocoded_at`, then reads sorted `.sql` files relative to its module path and runs every file at every backend startup. There is no migration ledger/checksum. SQL errors propagate to startup, which logs the generic `Database connection failed` and exits; each file is sent through `pool.query` without an explicit runner-managed transaction.
- `database/migrations/` contains `002_address_geocoded_at.sql` and `003_admin_auth_and_batches.sql`; `backend/src/db/migrations/` contains a second `003_admin_auth_and_batches.sql`. The runtime runner does not read `database/migrations/`. The 003 SQL is largely `IF NOT EXISTS`; this makes the present file replay-tolerant, but it does not make the migration history versioned or complete.
- The backend Docker build context is `backend/`. `backend/src/db/migrate.ts` resolves migrations beside the executing module (`src/db/migrations` in `tsx` development; `dist/db/migrations` after compile). `backend/Dockerfile` copies `src` and runs `tsc`; `backend/package.json::build` copies only the service-area GeoJSON/manifest via `scripts/copy-service-area-assets.mjs`. SQL migrations are not copied by TypeScript and the build script does not copy them. The compiled container path therefore has no repository-defined mechanism to package `dist/db/migrations`.
- `.github/workflows/ci.yml` starts `postgres:16-alpine`, initializes it by executing `database/schema.sql`, and enables one existing `reportTarget.postgres.test.ts` integration test. That test checks canonical scalar DB coordinates; it does not run the migration chain or require PostGIS. Unit and integration tests currently share the same backend Vitest include pattern.
- `database/seed.sql` starts with `TRUNCATE TABLE light_points RESTART IDENTITY CASCADE`; it is destructive when run against an existing inventory and must remain restricted to a disposable development/test database.

## 4. Fixed owner decisions recorded for P3

These are accepted requirements, not open questions:

1. **Partial success:** a batch may contain valid and failed rows; one bad row must not roll back valid rows. Admins can later inspect totals and row failures.
2. **Identity:** only `inventory_number` identifies a light point for duplicate detection. `external_id` is independent metadata and is allowed to repeat. Coordinates, address, DB `id`, and composite keys are not identity.
3. **Idempotency:** repeated imports do not create duplicate inventory. Unchanged rows are no-ops; changed accepted data updates the existing identity. A partially completed job can resume safely.
4. **Concurrency:** import jobs enter a queue and run sequentially. Optimize for one pre-production backend; do not add Redis or distributed infrastructure absent new evidence.
5. **Audit:** every committed inventory create/update/delete, including import writes, has an attributable timestamped record with safe changed-field evidence.
6. **Formats:** CSV, JSON, and GeoJSON are all required in P3.
7. **Database:** PostgreSQL with PostGIS is required, with a real spatial data/index/query use—not a decorative extension.

The earlier P3 gate for these choices is now satisfied by this owner request. The remaining gates are limited to details that the owner has not fixed and repository fixtures cannot establish (Section 14).

## 5. Target architecture and data boundaries

**PROPOSED — engineering:** retain the current Express/PostgreSQL deployment boundary and use four clear layers:

1. **HTTP/controllers:** authenticated admin routes parse request/query shapes and return stable public error codes. No SQL or transaction orchestration in controllers.
2. **Domain/import services:** parse/validate source rows, compute deterministic outcomes, enqueue jobs, and coordinate one-row processing. Do not use response text or DB exception strings as user-facing reasons.
3. **Persistence/repositories:** use an acquired `pg` client for explicit transactions; own identity lookups, geometry mapping, batch/row state, and audit writes.
4. **PostgreSQL/PostGIS:** enforce inventory identity, valid status/coordinates, durable job ordering, row outcomes, and audit atomicity.

The public map API and admin DTOs must expose `inventory_number` and `external_id` as separate properties. The UI may keep human-readable “Inventárne číslo” labels, but `mapAdminStreetLight`, API schemas, sorts/search, forms, import/export, and SQL must all agree on the separate fields. The report-target repository currently reads canonical inventory coordinates in `backend/src/domain/reportTarget.ts`; it must derive those coordinates from the new geometry without changing the accepted service-area result.

Import persistence must not call the geocoding/provider side effect. Current `createLightPoint`/`updateLightPoint` can reach `ensureLightPointAddress`; P3 import rows should use transaction-aware inventory persistence that stores only submitted/approved inventory fields. They must not enable or call Nominatim, Geoapify, CARTO, or AUSEMIO. Existing separate provider gates and report behavior stay unchanged.

## 6. Target schema and inventory identity

### 6.1 `light_points`

**PROPOSED — engineering target:**

| Column | Target meaning |
|---|---|
| `id` | Internal integer primary key; never used as business identity. Preserve current IDs during data migration. |
| `inventory_number` | Required string business identity, stored after trimming outer whitespace and Unicode NFC normalization; case and leading zeroes are preserved; unique in PostgreSQL. |
| `external_id` | Nullable independent source-system metadata; non-unique. Do not copy inventory numbers into this field after the transition unless a separate real source value exists. |
| `geom` | Sole coordinate source: `geometry(Point, 4326) NOT NULL`. |
| `address`, `address_geocoded_at`, `district`, `lamp_type` | Existing domain attributes, with the current geocoding gate preserved. |
| `status` | Existing checked values: `active`, `inactive`, `maintenance`; default `active` on create. |
| `created_at`, `updated_at` | `TIMESTAMPTZ NOT NULL`; expose as UTC ISO-8601. |

Normalize every write through the same canonical function: trim leading/trailing whitespace, normalize to Unicode NFC, preserve case, preserve leading zeroes, and keep the value as text. Thus ` 00123 ` becomes `00123`; `00123` differs from `123`; `ABC` differs from `abc`. Apply normalization before same-file grouping and DB lookup. Store only canonical values and enforce them with a unique index using deterministic, case-sensitive comparison (for example `inventory_number COLLATE "C"`); do not rely only on application lookups and do not make `external_id` unique. Empty-after-trim values fail validation.

### 6.2 Deterministic data transition

For the checked-in seed only, existing `external_id` values are the values presently represented to users as inventory numbers. The target fixture rewrite should move each value through trim + NFC normalization into `inventory_number`, set `external_id` to `NULL` where no independent external ID is evidenced, and encode the existing scalar coordinates as `ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)`. Keep the 255 seed records and their integer IDs; do not infer a new external ID.

For an existing DB, the migration preflight must report row counts, null/empty identity values, duplicates after trim + NFC (case-sensitive, leading-zero-preserving) normalization, invalid coordinate ranges, and any pre-existing geometry/extension state. The migration may copy current `external_id` into `inventory_number` only after explicit schema/data preflight confirms the expected pre-P3 shape. Any null/duplicate row stops the migration before destructive steps; never silently drop, merge, or rename inventory. Runtime DB contents are **UNKNOWN** until an operator performs this read-only preflight.

## 7. PostGIS design

### 7.1 Image and extension

**PROPOSED — engineering:** replace the local/CI `postgres:16-alpine` service with the official `postgis/postgis:16-3.5` image (PostgreSQL 16 / PostGIS 3.5 line; Debian-based upstream variant). At implementation time pin the reviewed image digest in local/CI deployment configuration, and verify `SELECT postgis_full_version()` in the disposable DB. The target DB migration explicitly enables `CREATE EXTENSION IF NOT EXISTS postgis`; no raster, topology, or extra extension is needed. This is not a live production deployment change in this checkpoint.

The official PostGIS image documentation lists PostgreSQL 16 with PostGIS 3.5 and recommends the Debian-based variant for stability; its current table lists `postgis/postgis:16-3.5` as PostgreSQL 16/PostGIS 3.5.2. The official PostGIS spatial-index guide documents GiST-backed geometry indexes and index-aware spatial predicates. Sources: [postgis/docker-postgis](https://github.com/postgis/docker-postgis), [PostGIS spatial index FAQ](https://postgis.net/documentation/faq/spatial-indexes/).

### 7.2 Geometry, constraints, and product use

Use `geometry(Point, 4326)`, not `geography`, because the application needs WGS84 map coordinates and viewport intersection, not global geodesic distance calculations. Geometry is authoritative; remove stored latitude/longitude after the deterministic migration. API serializers derive:

- `longitude = ST_X(geom)`
- `latitude = ST_Y(geom)`
- GeoJSON point coordinates `[ST_X(geom), ST_Y(geom)]` (longitude first).

Keep the existing scalar columns only during the one migration transaction; do not maintain writable duplicate coordinate columns after cutover. The geometry typmod enforces Point/SRID 4326. Add checks rejecting empty points and values outside longitude `[-180, 180]` / latitude `[-90, 90]`. Keep application validation as early feedback, with the DB as final invariant.

Add `GIST (geom)` for the existing map/inventory use case: an optional viewport-bounds filter on `GET /api/light-points` can use `ST_Intersects(geom, ST_MakeEnvelope(west, south, east, north, 4326))`. Omitting bounds must preserve the current full-list behavior. Do not use the viewport query to alter service-area classification. Do not migrate the accepted Košice boundary to a different geometry representation or replace the current JSTS classifier in this checkpoint; if a future change proposes a DB boundary predicate, it must first prove equivalence against the current versioned boundary, including edges/holes, or obtain an owner decision.

## 8. Migration source of truth and runtime

### 8.1 One canonical chain

**PROPOSED — engineering:** make `backend/src/db/migrations/` the sole authoritative ordered SQL migration source. This matches the backend’s runtime ownership and `backend/` Docker build context. Move the missing `002_address_geocoded_at.sql` content into the canonical chain as needed; remove the competing `database/migrations/` copies after equivalent baseline content is captured. Retire `database/schema.sql` as an initialization source rather than letting an unversioned schema and a migration chain compete. Keep `database/seed.sql` as an explicit development/test data script only, rewritten for the target columns and never mounted as an automatic Postgres init script. No migration/schema change is made in this planning task.

Package `.sql` files into the compiled backend output at the exact resolved runtime path (for example, `backend/dist/db/migrations/`) and add a compiled-container smoke check that enumerates/runs the packaged migration runner against disposable PostgreSQL. The current build only packages service-area assets, so this packaging step is required before a compiled deployment can use migrations.

### 8.2 Versioned application behavior

Use zero-padded numeric migration filenames in lexical order, e.g. `0001_initial_schema.sql`, `0002_p3_postgis_inventory.sql`. Add `schema_migrations(version PRIMARY KEY, name, checksum, applied_at)`. Runner requirements:

1. Acquire a PostgreSQL advisory lock for the migrator.
2. Read the ledger and validate stored checksums; a changed already-applied migration is a hard startup error.
3. Apply only unapplied migrations in deterministic order. Run each supported DDL migration and ledger insert in the same transaction. On any error, rollback that migration, release the lock, return a migration-specific error, and do not start HTTP listening.
4. Never replay completed migrations on normal startup. Re-running the runner with an unchanged ledger is a no-op.
5. Do not provide an automatic rollback that guesses how to restore data. Use a reviewed forward repair migration; backup/restore is an operator procedure.

The migration chain itself bootstraps a fresh empty database. For a current pre-P3 database with no ledger, a separate explicit adoption command must verify the current schema fingerprint and required table/column constraints before recording the known baseline version. It must stop on any unknown shape; do not automatically assume that a database is empty/current. Then apply the P3 migration. This one-time baseline adoption is not a long-term compatibility layer.

### 8.3 Fresh DB, seed, and tests

For local/CI fresh databases: initialize PostgreSQL only, run the versioned migration command, then invoke an explicit `seed:dev`/test-fixture command. Remove the existing Compose schema/seed init mounts after the migration flow is proven. `seed.sql` begins with `TRUNCATE ... CASCADE`, so seed command must refuse a non-disposable environment (e.g. require an explicit test/dev DB name/guard); it must never be an automatic production startup action.

The fresh migration result and the upgraded current-schema result must have the same target schema, migration ledger, constraints, and indexes. The current DB image is PostgreSQL 16; PostGIS becomes a mandatory extension in the disposable test service as well as runtime database provisioning.

## 9. Import intake, partial success, and durable evidence

### 9.1 Parser and preview

Keep the 5 MiB upload ceiling as the starting bound unless implementation evidence requires a separate owner-approved adjustment. Continue to accept CSV, JSON, and GeoJSON, but parse CSV with correct quoted-field, doubled-quote, CRLF/LF, and embedded-newline behavior. JSON arrays and GeoJSON FeatureCollections must preserve each data record/feature index. A malformed item with a recoverable record boundary becomes a visible row-level validation error rather than disappearing. A syntactically unparseable whole file fails preview with a safe file-level error.

Canonical import identity is `inventory_number` (accept the current documented camel-case `inventoryNumber` alias and canonical `inventory_number`). Normalize it by trimming outer whitespace and Unicode NFC while preserving case and leading zeroes. `external_id` is parsed independently as optional metadata and must never be treated as an inventory-number alias. GeoJSON requires a Point with `[longitude, latitude]` in WGS84. Do not persist the original file body. Preview displays source row number, normalized identity if parseable, validation/outcome proposal, and safe reason; it can remain short-lived/in-memory until confirmation.

For update-checkbox ON, replace every imported field represented by that row's import schema. The parser must retain field-presence metadata instead of collapsing absent, empty, and null values:

- **CSV:** a supported optional column present in the header is represented for each row; an empty cell means explicit null for nullable fields. A supported optional column absent from the header is not imported and preserves the existing value. Required identity/coordinate headers and nonempty values are required. A short/malformed record is a row failure rather than an implicit absent value.
- **JSON:** a supported property present with a value replaces that field; `null` or an empty string clears nullable fields; an absent property is not imported and preserves the existing value. `status`, when present, must be one of the supported non-null values.
- **GeoJSON:** apply the same property rules to `properties`; Point geometry is required and replaces coordinates. Coordinates remain `[longitude, latitude]` in WGS84.
- **New row defaults:** unrepresented/cleared nullable fields become `NULL`; absent status defaults to `active`; supplied invalid/empty status is a row failure. Import formats do not accept arbitrary unknown columns/properties as persisted fields.

The preview must explain that enabling update replaces represented fields and that blank CSV cells / explicit JSON or GeoJSON nulls clear nullable values. Disabling update leaves an existing DB row completely unchanged.

### 9.2 Persistent job and row records

Reuse/evolve the existing `import_batches` table as the durable job header rather than introducing parallel `import_batches` and `import_jobs` concepts. Add job state and timestamps (`queued_at`, `started_at`, `completed_at`, `lease_until`/worker token, `attempt_count`), sanitized filename, uploader, row totals, and summary counters. The detail table (proposed `import_batch_rows`) has a unique `(batch_id, source_row_number)` and stores:

- record number from the original CSV data-record/JSON array/GeoJSON feature order;
- `inventory_number` when available;
- terminal/pending outcome (`pending`, `created`, `updated`, `unchanged`, `skipped`, `failed`);
- entity ID when applicable;
- stable safe failure code/reason (no SQL, stack, tokens, or raw DB message);
- an allowlisted normalized payload, including field-presence metadata, only while the job has pending work.

Persist only fields needed to process/retry a row: normalized inventory number, independent external ID, coordinates/geometry values, address, district, lamp type, status, and per-format field-presence metadata. Do not persist raw upload bytes or arbitrary source properties. After terminal completion, delete the temporary row payload while keeping batch metadata and per-row outcome/failure evidence. For current pre-production there is no automatic expiry of batch/job metadata, row result/failure evidence, or inventory audit events; retain them until a production retention/privacy policy is defined. Use bounded detail endpoints (e.g. page size 50, maximum 100) rather than returning an unbounded failure array.

### 9.3 Row outcomes and summary formulas

Every recognized data record must have exactly one persisted outcome after completion:

| Outcome | Meaning |
|---|---|
| `created` | New inventory identity inserted. |
| `updated` | Existing identity changed in at least one accepted field. |
| `unchanged` | Existing row already equals the effective imported data; no inventory mutation or audit mutation event. |
| `skipped` | Deliberately not applied under a fixed rule: existing DB identity with update checkbox OFF, or an identical duplicate row after its canonical row in the same file. |
| `failed` | Row rejected or permanently failed; includes stable safe code/reason. |

`total = created + updated + unchanged + skipped + failed`.
`successful = created + updated + unchanged` (skipped rows are not successful).
`applied = created + updated` (rows that mutated inventory).
Equivalently, `total = successful + skipped + failed`. These formulas must be used consistently in API responses, admin summaries, examples, and tests; never include `skipped` in `successful`.
`failed` is the count of row-level failures; a systemic job failure remains a separate batch status and does not fabricate row failures. Preview invalid rows remain visible; if the admin confirms a valid mixed file, invalid rows are staged as `failed` outcomes along with valid `pending` rows. A wholly unparseable file is not enqueued.

Outcome examples: new valid identity → `created`; existing identity + update OFF → `skipped`; existing identity + update ON + changed state → `updated`; existing identity + update ON + identical state → `unchanged`; identical same-file repeat → canonical row processed once and subsequent rows `skipped`; conflicting same-file identity group → every row `failed`; invalid row → `failed`. For a batch with 2 `created`, 1 `updated`, 1 `unchanged`, 2 `skipped`, and 1 `failed`, `successful=4` and `total=7`.

Counters must not drift from row records. Update a pending row outcome and the corresponding batch counters in the same row transaction, guarded by `WHERE outcome='pending'` and a one-row affected check. A reconciliation query/test must verify each summary equals persisted row outcomes. Alternatively, deriving counters from rows is acceptable if query cost remains bounded; do not maintain counters in a separate non-atomic write.

## 10. Import idempotency, retry, and concurrency

### 10.1 Identity-based idempotency

**OWNER FIXED** behavior:

1. Missing/empty identity is a row failure; never insert an anonymous inventory row.
2. A new `inventory_number` creates one row. A DB unique constraint is the final defense against duplicate create races.
3. With the update checkbox OFF, an existing identity is `skipped`; the DB row, `updated_at`, and audit history remain unchanged.
4. With the update checkbox ON, replace each field represented by the import schema. Explicit empty/null clears nullable fields; an absent field not represented by the schema is preserved. If the effective resulting state is identical, classify `unchanged`, do not update `updated_at`, and do not write an inventory mutation audit event. Otherwise classify `updated` in one explicit row transaction. `external_id` may change independently and may be duplicated.
5. Re-uploading the same file may create a second batch-history record, but identity matching means it creates no duplicate light-point rows; unchanged rows become `unchanged`.
6. Confirm requests for the same short-lived preview must be idempotent: persist a unique preview/idempotency key with the batch in the enqueue transaction. A duplicate confirm returns the existing batch ID/status instead of creating a second job.
7. On process restart, a job resumes only rows still `pending`. Row outcome, inventory change, and audit event commit together, so a committed row is never repeated as a second mutation/audit event. If a transaction outcome is uncertain to the client, the worker reads the persisted row state before retry.

### 10.2 Same-file duplicate behavior (owner fixed)

Normalize and group all source rows by `inventory_number` before any DB writes. If all rows in a group have identical effective payloads and field-presence metadata, process the earliest source row once and mark each subsequent row `skipped` with safe code `duplicate_in_same_import` and a reference to the canonical source row. If any row in a group conflicts, mark every row in that identity group `failed` with safe code `conflicting_duplicate_inventory_number`; none of those rows may mutate the DB. Continue processing unrelated identities. Never use first-wins or last-wins for conflicting data.

### 10.3 Sequential PostgreSQL queue

Use PostgreSQL as the queue; do not use an in-memory queue as the durable source and do not introduce Redis. One backend worker consumes FIFO ordered by `(queued_at, id)`. State transitions:

`queued → processing → completed | completed_with_errors | failed`

- `completed_with_errors` means the job completed and at least one row failed; ordinary row failures do not make the whole job `failed`.
- A transaction-level or session advisory lock serializes the global job claim. Claim the oldest queued job with `FOR UPDATE SKIP LOCKED`, mark it processing, assign a random worker token/lease, and commit. Add a partial unique index allowing at most one `processing` batch as a second safety invariant.
- Process rows sequentially. Renew the lease/heartbeat while work continues. Each row transaction verifies the current worker token and claims only a pending row. No two import workers should process two batches in parallel.
- On clean completion, clear the lease and record `completed_at`. On process exit or lost DB connection, the DB releases connection locks; an expired lease is recoverable. A later worker reclaims the same batch, preserves prior row outcomes, and resumes pending rows only. A worker with a stale token must stop before starting another row.
- Deterministic FIFO ties use the identity `id`; retries resume the original batch in its original queue position rather than creating a new batch. Do not hold one DB transaction open across the entire batch.
- Two admin confirm requests race safely through the unique preview/idempotency key. Competing CRUD/import writes serialize by row lock/unique `inventory_number`; a uniqueness conflict is re-read and classified, not retried as an unconditional insert.

No distributed worker coordination is justified for the current one-backend, pre-production VM (Ubuntu 24.04, 2 vCPU, 4 GB RAM, 250 GB storage). The queue schema and lease must still be safe if a second process is accidentally started, but horizontal scaling is not a P3 goal.

## 11. Transaction boundaries and auditability

### 11.1 One inventory row transaction

Each valid import record is an independent transaction on one acquired `pg` client:

1. Lock/re-read the target identity or insert under the unique constraint.
2. Compare the effective accepted fields; do no write for `unchanged`.
3. Apply one create/update to `light_points` when needed.
4. Insert the corresponding structured inventory audit event in the same transaction.
5. Mark the `import_batch_rows` outcome/entity ID and update aggregate counters in that same transaction.
6. Commit. On any failure, rollback all inventory/audit/row/counter writes for that row.

If an audit insert fails, the inventory mutation must roll back. A permanent domain/constraint failure is then recorded as a failed row in a separate short transaction with a stable allowlisted error code. Transient database failures are retried with bounded backoff and leave the row pending until recovered or the batch reaches a separately recorded system failure; do not mislabel infrastructure failure as invalid user data.

CRUD create/update/delete follows the same transaction-aware repository boundary. Remove post-mutation audit writes from the controller. For delete, lock/read the existing entity, insert an audit event containing its stable identity snapshot, then delete in the same transaction; the audit event survives deletion. Do not wrap the entire import batch in one transaction.

### 11.2 Audit table direction

**PROPOSED — engineering:** keep `admin_activity_logs` for login/logout/technical activity and add a dedicated structured `inventory_audit_events` table for inventory mutations. This gives inventory history a stable constrained contract without turning generic `details JSONB` into an implicit domain schema. Fields should include:

- event ID and `TIMESTAMPTZ` timestamp;
- action (`create`, `update`, `delete`, `import_create`, `import_update`);
- nullable admin FK plus an actor username snapshot so identity remains useful if the admin row is removed;
- `entity_id` snapshot and `inventory_number` snapshot;
- nullable import batch ID;
- changed-field JSON object limited to an allowlist (`inventory_number`, `external_id`, geometry coordinates, address, district, lamp type, status), with only changed values before/after;
- no raw file, request body, credential, token, provider payload, or unrelated personal data.

Every successful create/update/delete/import mutation has exactly one event in the same transaction; if event persistence fails, the mutation rolls back. No-op `unchanged`, `skipped`, and `failed` rows have no inventory mutation event, though batch/row records retain the outcome and safe reason. The import batch ID links an import-created/updated event to its row/batch evidence. Delete evidence preserves the former entity ID, `inventory_number`, and safe deleted/changed fields after `light_points` is gone. In current pre-production, audit and batch/row evidence have no automatic expiry and remain until a production retention/privacy policy is defined.

## 12. API and admin UX plan

### 12.1 Proposed endpoints/data flow

Keep admin route protection through `backend/src/routes/admin.routes.ts::requireAdmin`.

| Operation | Proposed contract |
|---|---|
| `POST /api/admin/street-lights/import/preview` | Upload/parse/validate; return original row numbers, validation results, projected creates/updates/unchanged/errors, with bounded preview paging if needed. No inventory writes. |
| `POST /api/admin/street-lights/import/confirm` | Accept the update-existing checkbox value; transactionally persist batch header, checkbox choice, and normalized row staging, enqueue once, return `202` with batch ID/status. No inventory writes in the request. |
| `GET /api/admin/street-lights/imports/:id` | Return job state, timestamps, totals/counters, uploader and safe status. Polling must use a bounded interval/backoff. |
| `GET /api/admin/street-lights/imports/:id/rows?outcome=failed&limit=50&cursor=…` | Return bounded per-row evidence; stable source order; never raw DB errors. |
| `GET /api/admin/logs/imports` | Paged batch history with current summary fields; provide link to details. |
| `GET /api/admin/street-lights/export?format=csv\|json\|geojson` | Same logical fields and filters for every format; all matching filtered rows, not current table page. |
| `GET /api/light-points?bbox=west,south,east,north` | Optional map viewport filter using the PostGIS GiST index; no bounds preserves existing full-list result. Validate all bounds and reject invalid envelopes. |

Endpoint path names are an engineering proposal; tests must lock whichever path is adopted. Do not add a public report-submit endpoint or alter AUSEMIO behavior under P3.

### 12.2 Admin experience

Update `frontend/src/pages/AdminImportPage/AdminImportPage.tsx` to show a complete file summary and preview including invalid rows, an update-existing checkbox with the label `Aktualizovať existujúce svetelné body s rovnakým inventárnym číslom`, and a warning: when enabled, existing matching rows are replaced for represented fields and empty nullable values clear existing data. Each import confirmation starts with the checkbox explicitly OFF/unchecked; the admin must deliberately opt in for that confirmation to update existing rows. Do not remember or persist this checkbox preference across imports or sessions. With OFF, new identities are created and existing identities are skipped without changing their data, `updated_at`, or audit history. With ON, represented values replace existing values; present empty/null clears nullable fields, while absent fields are preserved; changed rows are `updated` and identical rows are `unchanged`. After confirmation show queued/processing/completed state. Completion feedback includes total, successful, failed, created, updated, unchanged, and skipped counts, using `successful = created + updated + unchanged` and `total = successful + skipped + failed`. Provide a server-paged failed-items table with row number, `inventory_number` when available, and concise safe reason. Admins can reopen historical batch details later.

Update `frontend/src/pages/AdminLogsPage/AdminLogsPage.tsx` and `frontend/src/services/adminApi.ts` for durable history/details. Admin can leave the page, return later, and inspect completed batches. A large failure set is paginated/filtered; the UI does not fetch or render all rows at once. HTTP errors use stable codes/messages and never expose SQL text or stacks.

Update inventory list/detail/form/API mapping across `frontend/src/pages/AdminStreetLightsPage/`, `AdminStreetLightFormPage/`, `AdminStreetLightDetailPage/`, `frontend/src/types/admin.ts`, `frontend/src/types/lightPoint.ts`, and `frontend/src/services/lightPointsApi.ts` so `inventory_number` and `external_id` are independent. Search must identify each field explicitly and cannot silently use `external_id` as a business key.

## 13. Export contract (logical schema v1)

**PROPOSED — engineering; preserves current filter scope:**

All formats represent the same selected inventory rows and logical fields:

`id`, `inventory_number`, `external_id`, location, `address`, `district`, `lamp_type`, `status`, `created_at`, `updated_at`.

| Format | Representation |
|---|---|
| CSV | UTF-8 header: `id,inventory_number,external_id,longitude,latitude,address,district,lamp_type,status,created_at,updated_at`. Quote fields containing comma, quote, CR, or LF; double embedded quotes. Null values serialize as empty fields (documented as indistinguishable from empty text in CSV). Timestamp fields are UTC ISO-8601 with `Z`. |
| JSON | Object `{ "schemaVersion": 1, "items": [...] }`; each item has the same named fields, numeric `longitude`/`latitude` derived from geometry, nulls preserved as JSON `null`, and timestamps serialized in UTC ISO-8601. |
| GeoJSON | RFC 7946 `FeatureCollection`, WGS84, no legacy `crs` member. Each `Feature.geometry` is `Point` coordinates `[longitude, latitude]`; `properties` contain `id`, `inventory_number`, `external_id`, address, district, lamp type, status, timestamps. A documented schema-version foreign member may identify application schema v1. |

Status values remain exactly `active`, `inactive`, `maintenance`. Null address/district/lamp/external ID are null in JSON/GeoJSON and empty CSV cells. Search/status/district filter semantics are shared; search includes `inventory_number`, `external_id`, address, district and exact internal ID (consistent with the admin list). Export is all rows matching the active filters, regardless of admin pagination, matching the current export service. Ordering is deterministic by canonical `inventory_number` using the same case-sensitive comparison, then `id`; never depend on planner order.

CSV uses one stable header and no unescaped metadata preamble. JSON and GeoJSON carry schema version 1; the documented CSV header contract is version 1 and a breaking field/header change increments it. Round-trip tests cover exported values that the importer accepts; they must not imply that arbitrary extra columns are silently imported or that export imports are always lossless for null-vs-empty CSV values.

## 14. Owner decisions recorded as final

The following choices are final for this P3 planning checkpoint and must be represented directly in tests and implementation:

| ID | Final owner decision | Plan consequence |
|---|---|---|
| P3-O1 | Normalize `inventory_number` by trimming leading/trailing whitespace and Unicode NFC; preserve case and leading zeroes; keep string. | Apply one canonical function before CRUD/import identity lookup and same-file grouping; enforce uniqueness in PostgreSQL. `00123` differs from `123`; `ABC` differs from `abc`. |
| P3-O2 | Identical normalized identity rows with identical effective data: process one canonical row and mark later rows skipped. Conflicting rows for one identity: fail every row in the group and mutate none. | Pre-group before writes; continue with unrelated identities; never use first-wins/last-wins for conflicts. |
| P3-O3 | Update checkbox OFF skips existing rows unchanged. ON replaces represented fields; explicit empty/null clears nullable fields; absent schema fields are not imported and remain unchanged. | Preserve presence metadata across CSV/JSON/GeoJSON; compare effective resulting state; identical state is unchanged without mutation/audit. |
| P3-O4 | Do not persist raw files. Persist batch/job metadata, row result/failure evidence, and audit events. Current pre-production has no automatic retention expiry. | Purge normalized processing payload at terminal completion; retain minimal batch/row/audit evidence without automatic expiry until production retention/privacy policy is defined. |

**No P3 owner decision remains unresolved.** Production retention remains a future legal/privacy/operations policy decision; it does not block this pre-production implementation. Unknown runtime DB contents remain an operational preflight requirement, not an open product decision. No deployment-hosting, live-provider, AUSEMIO, or service-boundary decision is made here.

## 15. Test and evidence matrix

All DB guarantees below require a **real disposable PostgreSQL/PostGIS 16 database** using the same image/version and migration runner as the application. Mocked pool queries are not evidence for uniqueness, transaction, locking, migration, or geometry behavior. The integration suite must create/reset its own disposable database/schema and must never connect to a developer or production database. Keep the integration process serial/exclusive; unit tests may remain parallel.

| Area | Required evidence |
|---|---|
| Fresh migration | Empty DB → all migrations; `postgis` extension/version; complete schema, ledger, constraints and indexes. Backend does not listen if a migration fails. |
| Migration replay | Run migrator twice; second run is a no-op; same ledger rows/checksums; no duplicate objects or seed data. Changed applied checksum fails closed. |
| Existing-schema adoption | Build representative current pre-P3 schema from `database/schema.sql`; include all 255 seed rows; run read-only preflight/adoption then P3 upgrade. Compare with fresh target schema; preserve IDs/coordinates/row count and inventory identities; fail before destructive work on null/duplicate/out-of-range fixture. |
| Seed safety | Updated seed maps 255 checked-in identities and point coordinates into target columns; refuses non-disposable DB; never runs from production startup. |
| Identity constraints | Trim + NFC normalization; case preserved; leading zeroes preserved; `00123` differs from `123`; `ABC` differs from `abc`; unique normalized `inventory_number` rejected by DB; duplicate `external_id` accepted; IDs not identity. |
| Geometry | Point/SRID 4326; longitude/latitude range checks; empty/invalid shape rejected; geometry round-trips to API coordinates; GeoJSON longitude-first. GIST index exists; bbox query returns correct inside/outside rows. |
| CRUD and audit | Create/update/delete use real DB; one event per actual mutation; unchanged no event; changed fields safe and correct; actor and inventory identity recorded; delete event remains after entity deletion; forced audit insert failure rolls back the inventory mutation. |
| Import parse/preview | CSV quoting/CR/LF/embedded newline/BOM; JSON arrays; GeoJSON FeatureCollection and Point ordering; malformed structure vs recoverable row errors; all source data rows and row numbers retained; identity alias separation (`inventory_number` vs `external_id`). |
| Partial success | Mixed valid/invalid rows: valid rows persist, invalid rows do not partially mutate; all results are visible after request/process restart; totals and each counter equal persisted row outcomes. |
| Row atomicity | Inject a row constraint or audit failure: no partial inventory mutation, audit event, counter, or terminal success for that row. Other good rows commit. Retryable DB errors leave pending/recoverable state. |
| Idempotency | New row creates once; same data becomes `unchanged` with no duplicate row/event; changed accepted data updates once; repeated confirm is same job; repeated file is new history but no duplicate inventory; partial job restart resumes only pending rows. |
| Same-file duplicates | Identical effective duplicate rows process once with later rows `skipped`; any conflicting group fails every row with no mutation; unrelated identities continue; no order-dependent writes. |
| Update-checkbox semantics | Every confirmation starts OFF/unchecked and requires deliberate opt-in; preference is not persisted across imports or sessions. OFF: new identity is `created`; existing identity is `skipped` and its data, `updated_at`, and audit history remain unchanged. ON: represented values replace; present empty/null clears nullable fields; absent schema field preserves; changed existing row is `updated`; identical effective state is `unchanged`; invalid status fails. |
| Import summary accounting | Assert `successful = created + updated + unchanged`; `total = successful + skipped + failed`; skipped is excluded from successful. Verify exact counters from persisted row outcomes, including an example with created, updated, unchanged, skipped, and failed rows. |
| Retention | Raw uploads are never persisted; normalized pending payload is removed at terminal state; batch/row/audit evidence has no automatic expiry in pre-production. |
| Queue/concurrency | Two queued jobs execute FIFO and never overlap; concurrent claim attempts produce one worker; duplicate confirm has one batch; worker crash/lease expiry reclaims pending rows; stale worker token cannot continue; row locks/unique identity handle competing CRUD. |
| History/detail | Batch and row evidence survive process restart; admin-authenticated history/detail endpoints return bounded pages and stable safe reasons; unrelated/unauthorized admin access is rejected by existing auth middleware. |
| Export | CSV CR/LF/quote/comma escaping and nulls; JSON schema version/field parity; GeoJSON FeatureCollection/RFC 7946 Point coordinates; timestamps/status/null consistency; same filters and full filtered result across formats; stable ordering; round-trip on supported non-null values. |
| External isolation | Import unit/integration tests inject providers as forbidden/fake and assert zero upstream calls. No AUSEMIO requests, live geocoder/tile calls, or `/api/reports/send` path is introduced by P3. |
| Compiled runtime | Build backend; assert SQL migration assets exist in compiled image at runner path; run the packaged runner against disposable PostGIS DB; verify startup stops on migration failure. |

Add focused unit tests for pure parsing/format mapping, but do not substitute those for the database matrix. CI’s PostGIS service replaces the current `postgres:16-alpine` service for these tests after the P3 test runner is implemented. No such CI change is made now.

## 16. Implementation sequence and gates

The sequence keeps independent work moving while isolating owner-dependent work:

1. **P3-A — migration/test foundation (can begin after independent plan audit):** establish a disposable PostGIS integration harness, migration ledger/checksum/advisory lock, SQL asset packaging, startup failure behavior, and current-schema fingerprint/adoption preflight. No import policy is embedded in this stage.
2. **P3-B — PostGIS/inventory storage transition:** geometry source of truth, coordinate constraints/GiST index, API coordinate projection, deterministic seed/fixture transition, and normalized `inventory_number` uniqueness. Perform read-only runtime data preflight before applying any identity migration; stop on nulls or collisions after trim + NFC. Do not change Košice boundary classification.
3. **P3-C — inventory contract:** separate inventory_number/external_id through backend types/services/controllers and frontend public/admin DTOs, CRUD, search/sort. Add DB-backed constraints and transactional CRUD audit; coordinate migration tests with report-target repository behavior.
4. **P3-D — export v1:** common canonical row mapping, same filters, all matching rows, deterministic order, schema version, CSV/JSON/GeoJSON tests. This can proceed independently of the import duplicate/update gates after the inventory data/API model is decided.
5. **P3-E — import parser and preview:** preserve source row numbers and validation failures, separate fields, robust CSV, trim + NFC normalization, same-file pre-grouping, and explicit field-presence state for CSV/JSON/GeoJSON.
6. **P3-F — durable queue and worker:** add persistent header/row state, one sequential DB worker, idempotent confirm, checkbox-controlled replacement/skips, leases/recovery, row transaction + audit + counters. Implement the fixed same-file grouping and update semantics; retain evidence without automatic pre-production expiry.
7. **P3-G — admin status/history:** enqueue/poll/status/detail/failure pagination and history UX; exact checkbox warning and complete summary vocabulary; stable safe reason codes.
8. **P3-H — full acceptance and independent result review:** run every matrix row on disposable PostGIS, backend/frontend typecheck/build and tests, migration runner in compiled Docker image, diff review, and capture evidence. No provider activation or AUSEMIO access.

Behavior-changing persistence/import work remains subject to the repository’s accepted test-first and CI requirements. P3 planning itself does not authorize implementation or deployment.

## 17. Acceptance criteria

P3 implementation is acceptable only when all applicable criteria have evidence:

1. One canonical, ordered, checksummed SQL migration chain builds a fresh DB and upgrades an explicitly recognized current DB to the same PostgreSQL/PostGIS target. Migrations are applied once, transactional where supported, and startup fails closed on mismatch/error.
2. Compiled backend images contain SQL files exactly where the migration runner resolves them; integration tests prove this runtime path.
3. `inventory_number` is required text and the only unique business identity; `external_id` is separate and may duplicate. The owner-approved normalization is enforced in DB and tests. Current seeded rows and fixtures migrate without loss.
4. A single Point geometry with SRID 4326 is authoritative; valid bounds are constrained; API coordinates are derived; a GiST-backed viewport query has real results; Košice/service-area semantics do not change.
5. Imports are durably queued and sequential. A batch with mixed row outcomes completes with exact persisted totals, per-row safe evidence, and details viewable later. Process restart resumes pending rows only.
6. Same identity + same effective data is unchanged/no mutation; changed accepted data is updated; repeated upload/confirm cannot duplicate inventory or mutation events. Same-file duplicate behavior matches the approved deterministic policy.
7. Each committed CRUD/import mutation has exactly one transactionally consistent audit event. Audit failure rolls back the mutation; delete evidence retains the deleted identity. No credentials, raw uploads, or unnecessary personal data are included.
8. CSV, JSON, and GeoJSON export the same filtered inventory set and logical fields, with version/status/null/timestamp/coordinate behavior from Section 13. CSV escapes CR, LF, quotes, and commas correctly; GeoJSON follows RFC 7946 WGS84 ordering.
9. Admins can see upload validation, queued/processing/completed state, all required counts, paged failure reasons, and durable import history without raw SQL/internal errors. Every confirmation starts with update-existing OFF/unchecked and requires deliberate opt-in; OFF creates new identities and skips existing ones unchanged, while ON updates changed represented fields and leaves identical rows unchanged. No checkbox preference is carried into another import/session. Summaries satisfy `successful = created + updated + unchanged` and `total = successful + skipped + failed`; skipped is never counted as successful.
10. Real disposable PostgreSQL/PostGIS tests pass the migration, identity, transaction, import, queue, recovery, audit, geometry, export, and isolation matrix. Mocks remain limited to pure/unit boundaries.
11. No P3 code path activates live tile/geocoder providers, sends AUSEMIO traffic, creates `/api/reports/send`, changes service `2`/service `16` product scope, adds Redis, or implements P5 separate-admin deployment.

## 18. Risks and non-goals

- **Data risk:** the checked-in seed is not a runtime DB snapshot. Identity uniqueness can fail if actual inventory contains nulls or duplicates under the chosen rule. Preflight and stop-on-ambiguity are mandatory.
- **Migration risk:** `database/schema.sql`, two migration directories, inline DDL, and compiled SQL asset packaging currently disagree. Do not begin identity data migration until the canonical runner can reproduce a disposable schema and current-schema adoption is tested.
- **Transaction risk:** current CRUD/import services use independent `pool.query` calls and provider side effects. Reusing them inside a transaction would not make the existing sequence atomic; create a client-bound persistence boundary.
- **Queue risk:** a database lease and a single worker must be tested under process termination and stale worker ownership; never assume an in-memory `Map` is durable.
- **Audit risk:** generic `details JSONB` and post-write logging are insufficient for atomic evidence. A dedicated structured event contract is recommended; pre-production evidence retention is fixed to no automatic expiry until a later production policy is approved.
- **Resource risk:** keep the queue sequential, uploads bounded, failure details paged, and avoid Redis/distributed coordination on the intended 2-vCPU/4-GB pre-production host.
- **Provider/network safety:** no live provider requests are needed. Import must not opportunistically geocode rows. P3 must not open or write AUSEMIO, activate CARTO/Geoapify/Nominatim, or create report-submit behavior.
- **Out of scope:** report submission/AUSEMIO, service `16`/CSS, provider failover/licensing, database persistence for citizen reports, P5 admin application/deployment boundary, production hosting changes, authentication redesign, and live deployment.

## 19. Unknowns and evidence limits

- **UNKNOWN — live DB:** no runtime PostgreSQL contents, current local volume state, or hosted DB state were queried. The 255-row seed statistics are not a statement about live data.
- **UNKNOWN — authoritative inventory file/runtime DB:** no representative authoritative source file or live DB contents were inspected. The owner has fixed normalization regardless; perform the required read-only preflight for nulls/collisions before the migration and stop on data conflicts.
- **UNKNOWN — max useful import/history size:** the current upload cap is 5 MiB, but operational data volume and batch-history growth have not been measured. Preserve the existing upload cap initially and measure synthetic load during implementation.
- **UNKNOWN — production retention:** no production expiry period is defined. This does not block P3: current pre-production evidence has no automatic expiry; production retention is a future legal/privacy/operations decision. Raw uploads are never persisted.
- **UNKNOWN — exact runtime PostGIS digest:** the proposed tag is verified from upstream documentation, but the image digest and supported architecture must be pinned/rechecked when implementation starts.

## 20. P3 project map

| Area | Purpose | Main files/directories | Important dependencies |
|---|---|---|---|
| Database baseline/seed | Current schema, inventory fixtures, sample import formats | `database/schema.sql`, `database/seed.sql`, `database/import-examples/` | PostgreSQL 16; Compose init behavior |
| Migration runner | Startup DDL and SQL asset resolution | `backend/src/db/migrate.ts`, `backend/src/db/migrations/`, `backend/Dockerfile`, `backend/package.json` | `pg`, Node ESM/TypeScript build, PostGIS image |
| Inventory persistence | CRUD and map/public point reads | `backend/src/services/lightPoints.service.ts`, `backend/src/services/adminStreetLights.service.ts`, `backend/src/db/pool.ts`, `backend/src/types/lightPoint.ts` | PostgreSQL constraints; geocoding seam must stay out of import transactions |
| Import parser/worker | File parse, preview, durable job, row transactions | `backend/src/services/streetLightsImport.service.ts`, `backend/src/middleware/upload.ts`, `backend/src/controllers/adminStreetLights.controller.ts`, future `import_batch_rows` migration | PostgreSQL row locks, unique identity, queue state, tests |
| Export | CSV/JSON/GeoJSON serialization and filters | `backend/src/services/streetLightsExport.service.ts`, controller route | Canonical inventory DTO, PostGIS coordinate projection |
| Mutation audit | Actor/entity/field-level history | `backend/src/services/adminActivity.service.ts`, `database/schema.sql`, future audit migration | Same transaction/client as inventory mutation; admin auth context |
| Admin import/history UI | Upload, preview, queue status and failure detail | `frontend/src/pages/AdminImportPage/`, `frontend/src/pages/AdminLogsPage/`, `frontend/src/services/adminApi.ts`, `frontend/src/types/admin.ts` | Protected `/api/admin` routes and paged batch/row API |
| Public map/API | Public marker model and optional bbox fetch | `backend/src/routes/lightPoints.routes.ts`, `backend/src/controllers/lightPoints.controller.ts`, `backend/src/services/lightPoints.service.ts`, `frontend/src/services/lightPointsApi.ts`, `frontend/src/types/lightPoint.ts` | PostGIS `geometry(Point,4326)` and GiST index |
| DB integration tests | Migration, transaction, queue, spatial and export evidence | `backend/tests/integration/`, `.github/workflows/ci.yml`, `backend/vitest.config.ts` | Disposable `postgis/postgis:16-3.5`; no shared developer/production DB |

## 21. Final checkpoint status

**P3 implementation plan:** ready for independent audit.
**Production implementation:** not started or authorized by this planning artifact.
**Database/schema/runtime/CI/dependencies:** unchanged.
**External providers/AUSEMIO:** no access or network traffic occurred.
**Owner decisions:** P3-O1 through P3-O4 are final and incorporated; no owner decision remains open for this plan. Production retention policy remains future work and does not block P3.
