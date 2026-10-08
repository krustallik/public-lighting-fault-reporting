# Database Operations, Recovery, and Retention Plan

**Status:** planning/research only — ready for independent plan audit.
**Baseline inspected:** `master` at `3e2d89cd72ef30469929d23479a6f2590a6a0674`.
**Implementation status:** none authorized or performed by this checkpoint.
**Product boundaries:** AUSEMIO remains on hold; service `2` / VO only; service `16` / CSS remains out of scope. No provider or AUSEMIO traffic is needed for database operations.

This is the canonical proposal for production PostgreSQL backup, restore, recovery, one-year operational-history retention, and operational evidence. It distinguishes repository facts, binding owner requirements, engineering recommendations, and external infrastructure gates. It does not claim that production data, backups, recovery drills, or monitoring have been inspected or exist.

## 1. Executive summary

The repository defines a production Compose topology with PostgreSQL 16/PostGIS 3.5 on one persistent Docker named volume and no published PostgreSQL host port. It contains a hash-checked, transactional migration runner and three constrained application roles. The checked-in production foundation explicitly says there is no backup job, off-host copy, restore drill, retention cleanup, monitoring setup, rollback procedure, or target-host capacity result. These are current repository facts, not a live-host inspection. See `docker-compose.production.yml`, `backend/src/db/migrate.ts`, `database/production/`, and `docs/deployment/production-foundation.md`.

Binding requirements remain PostgreSQL 16 + PostGIS, Ubuntu 24.04 with 2 vCPU / 4 GB RAM / 250 GB disk, private database access, the existing three application roles and their separation, RPO ≤ 24 hours, RTO ≤ 4 hours, and one year for approved import/history/audit/admin operational history. They are not reopened here.

### Recommended operational shape

1. Use a complete PostgreSQL custom-format logical dump (`pg_dump -Fc`) every six hours, at 00:00, 06:00, 12:00, and 18:00 UTC. This gives margin under the 24-hour RPO while keeping one-host operations simpler than physical base backup plus continuous WAL archiving. PostgreSQL documents `pg_dump` as consistent while the database is concurrently read/written and describes the custom archive as compressed and restorable by `pg_restore` ([PostgreSQL 16 backup chapter](https://www.postgresql.org/docs/16/backup.html), [`pg_dump`](https://www.postgresql.org/docs/16/app-pgdump.html)).
2. Encrypt on the host before transfer using recipient/public-key encryption (recommended candidate: `age`), then stream the ciphertext over TLS to a separate object-storage failure domain. The private decryption identity must not be available to the routine backup job or stored only on the production VM. `age` supports streaming from standard input and encryption to one or more public recipients ([upstream age project](https://github.com/FiloSottile/age)).
3. Keep 30 days of verified backup generations as an initial engineering proposal: 120 scheduled generations at four per day, excluding failed/incomplete uploads. It is separate from one-year database-row retention and must be sized from an observed database/archive size before activation.
4. Run scheduled tasks through host `systemd` oneshot services/timers that invoke a narrowly scoped Compose backup/maintenance task. Keep the DB dump container on the private DB network only; do not give it provider egress. Have the host encrypt/upload the stdout stream using a separate storage credential. The exact destination and network egress policy remain infrastructure decisions.
5. Restore only into an isolated, fresh PostgreSQL 16/PostGIS environment. Restore a no-owner/no-ACL archive under a controlled DBA identity, then apply the canonical role/grant procedure and verify the migration ledger and representative application paths. Never overwrite the only current DB in place as the first recovery action.
6. Run one-year cleanup daily from a single UTC cutoff. Delete only explicitly approved history categories in bounded transactions, preserve live/nonterminal import work, and keep inventory/admin/system metadata. Treat `integration_logs` as `OWNER DECISION REQUIRED` until its retention classification is explicit. Keep the destructive retention implementation in its own later PR and independent audit.
7. Do not claim RPO/RTO compliance until a timed restore drill on the actual target class demonstrates it. The repository cannot establish that a 250 GB disk, a replacement-host path, or a 4-hour full-VM recovery is sufficient.

## 2. Evidence and status labels

- **REPO FACT** — directly visible in tracked source/configuration at the baseline above; not evidence about an uninspected production host or database contents.
- **OWNER REQUIREMENT** — binding decision supplied for this checkpoint.
- **PROPOSAL** — recommended engineering design/value; not an existing behavior or an additional owner decision.
- **INFRASTRUCTURE DECISION REQUIRED** — a deployment/account/host/credential capability absent from repository evidence.
- **OWNER DECISION REQUIRED** — a product/data classification not safely inferable from schema or code.

Primary evidence paths are named inline. External technical statements are linked in the relevant sections and collected in [References](#references).

## 3. Current production topology and database facts

### 3.1 Production topology

**REPO FACT:** `docker-compose.production.yml` pins the database image as `postgis/postgis:16-3.5@sha256:94146ac37bc61e2322f88016056c5920729cb8c64c8542ed590af8fc2abdac07`. The declared version family is PostgreSQL 16 with PostGIS 3.5. The exact image digest is pinned; no registry inspection or live database version query was performed for this checkpoint.

**REPO FACT:** Compose stores PGDATA in named volume `production_pgdata`, named from `${PRODUCTION_DB_VOLUME:-public-lighting-production-pgdata}`. The database service has only the internal `db-private` network and no host `ports`; only Nginx publishes ports 80/443. The application container uses `lighting_runtime`; the one-shot migration profile uses `lighting_migrator`; the bootstrap profile uses `lighting_bootstrap`. `backend` joins `provider-egress`, but `db`, migrations, and bootstrap do not.

**Unknown:** the actual VM, Docker data-root path, volume filesystem/mount, encryption of the VM disk, measured volume size, free disk, database size, growth rate, connection saturation, and import workload are **not determined from the repository**. The configured 250 GB disk does not establish usable DB/restore capacity.

`docs/deployment/production-foundation.md` says the HTTP service does not migrate or seed data; controlled migration is a separate release-profile task. `backend/src/index.ts` performs `SELECT 1`, calls `assertMigrationsCurrent(pool)`, starts the import worker, then listens. `backend/src/db/migrate.ts::runMigrations` applies migrations only through the explicit migration command, uses a two-key advisory lock, and runs each migration in a transaction. Migration `0002` takes an `ACCESS EXCLUSIVE` lock on `light_points` and runs a read-only preflight before applying its DDL (`backend/src/db/migrationPreflight.ts`).

### 3.2 Canonical migration state

Current canonical SQL migrations are:

- `backend/src/db/migrations/0001_initial_schema.sql`
- `backend/src/db/migrations/0002_p3_postgis_inventory.sql`

The migration runner creates `public.schema_migrations` on an empty recognized database. Its columns are `version` (primary key), `name`, `checksum` (`CHAR(64)`), and `applied_at TIMESTAMPTZ DEFAULT NOW()` (`backend/src/db/migrate.ts::createLedger`). Before startup, `assertMigrationsCurrent` requires the packaged migration version/name/checksum sequence to match the ledger exactly. Migration checksum mismatches, missing ledger, or unapplied packaged migrations prevent HTTP startup. There are no down migrations or production rollback script in the repository (`docs/deployment/production-foundation.md`).

### 3.3 Current health, cleanup, logging, and operations

- PostgreSQL Compose health is `pg_isready`; backend health calls `/api/health`, whose `checkHealth()` does `SELECT 1` (`backend/src/services/health.service.ts`). These checks establish connectivity only, not recoverability or data correctness.
- The import worker starts with the backend, takes a PostgreSQL advisory lock, and retries queue work. Each import row's inventory write, audit event, row outcome, and payload clearing occur in one transaction (`backend/src/services/importQueueWorker.service.ts::processImportRow` / `setOutcome`). A whole multi-row batch is not one atomic transaction.
- Preview batches expire after 15 minutes (`backend/src/services/streetLightsImport.service.ts::buildImportPreview`). Both preview API calls and `importQueueWorker.service.ts::claimBatch` delete expired `status='preview'` batches; the latter polls while the worker runs. This is opportunistic preview cleanup, not the requested annual retention scheduler.
- `backend/src/middleware/upload.ts` uses Multer memory storage with a 5 MiB file limit, one file, zero multipart fields. `backend/src/controllers/adminStreetLights.controller.ts::importPreview` parses the uploaded buffer. Raw upload files are not written to a persistent upload directory by these code paths. Pending normalized row payloads are persisted in `import_batch_rows.payload`; the worker clears them when a row receives a terminal outcome. This is durable normalized import state, not a retained raw upload.
- Refresh JWTs have a 30-day lifetime (`backend/src/config/auth.ts`); `backend/src/services/auth.service.ts` stores only a SHA-256 token hash, marks sessions revoked on refresh/logout, and checks `expires_at`/`revoked_at`. No scheduled expired-session purge was found.
- AUSEMIO remains on hold. The current simulated service `backend/src/services/aussemio.service.ts::sendReportToExternalSystem` writes technical metadata to `integration_logs` and never performs a network POST. `backend/src/config/ausemioMapping.ts::mapReportToTechnicalLog` omits contact/free text/coordinates and records only technical mapping fields, file count, locale, simulated status, reference, timestamp, and optional light-point ID. This is current source behavior; the table schema remains generic JSONB and no production data was inspected.
- `docker-compose.production.yml` and `docs/deployment/production-foundation.md` contain no backup, restore, annual-retention, alerting, scheduled-maintenance or migration rollback service. No production monitoring provider, off-host storage account, backup identity, or restore key is established in the repository. The workflow `.github/workflows/ci.yml` has backend/frontend and informational report jobs but no backup/restore/retention implementation or production DB job.

## 4. Database persistence and retention classification

The matrix below comes from migrations `0001_initial_schema.sql` and `0002_p3_postgis_inventory.sql`, with runtime-ledger creation in `backend/src/db/migrate.ts`. It describes code/schema, not observed row counts. All timestamps are `TIMESTAMPTZ`; the proposed jobs set the database session timezone to UTC and use a single captured UTC cutoff.

| Table | Purpose / key contents | Relations and constraints | Classification and one-year treatment | Authoritative timestamp / deletion rule |
|---|---|---|---|---|
| `light_points` | Current lighting inventory: canonical NFC `inventory_number` (unique under `COLLATE "C"`), PostGIS `geom geometry(Point,4326)`, optional external ID/address/district/lamp type, status, created/updated timestamps. Status is constrained to `active`, `inactive`, `maintenance`, default `active`; geometry and inventory identity have validity/canonical checks. | No outgoing FK from this table in current migrations; inventory audit keeps snapshots rather than a live FK. | **Not one-year history.** Core inventory/master data; never delete through retention. It is included in full database backups. | No automatic retention cutoff. Only existing explicit admin inventory deletion may remove a row. |
| `admins` | Admin username (unique), password hash, optional full name, active flag default true, created timestamp. | Referenced by refresh sessions (`ON DELETE CASCADE`), import batches and admin activity logs (`ON DELETE SET NULL`), and inventory audit actors (`ON DELETE SET NULL`). | **Not one-year history.** Account/authentication master state; no automated deletion. | No automatic cutoff. Deactivation/account lifecycle remains explicit administrative work. |
| `admin_refresh_sessions` | UUID session ID, `admin_id`, token hash, `expires_at`, optional `revoked_at`, `created_at`. | `admin_id → admins.id ON DELETE CASCADE`; indexes on admin and token hash. | Auth/session state governed by existing 30-day token expiry, not one-year operational-history policy. | Proposed separate purge: `expires_at < captured run start UTC`; never delete an unexpired session, even if old or revoked. Keep the 30-day auth behavior unchanged. |
| `integration_logs` | Integration type, reference, request/response JSONB, status default `pending`, optional error text, created timestamp. | No FK. Current service writes a simulated technical AUSEMIO record; schema permits generic payload JSONB. | **OWNER DECISION REQUIRED.** Decide whether this technical integration history is within approved one-year “history/admin-log” retention. Retaining risks preserving payload/error data indefinitely; deleting risks removing diagnostic/audit evidence. Until decided, annual cleanup must not delete it. Do not infer from the `integration_logs` name or current synthetic writer alone. | If owner includes it: `created_at < cutoff`, only after reviewing payload/error contents and approved access. Otherwise preserve pending a separate policy. |
| `import_batches` | Import filename and uploader snapshot, row counters, update policy, status, confirmation key, queue/lease/worker metadata, lifecycle timestamps. Allowed statuses: `preview`, `queued`, `processing`, `completed`, `completed_with_errors`, `failed`, `system_failed`. | `uploaded_by_admin_id → admins.id ON DELETE SET NULL`; owns `import_batch_rows` by cascade; referenced by audit events with `ON DELETE SET NULL`. One processing batch partial unique index, queue-order index, partial unique confirmation key. | Approved import history; one-year retention applies only to terminal historical batches. Live work must be preserved. `failed`/`system_failed` statuses are allowed by schema; no active writer for these values was found in the current queue worker. | For terminal batches, `completed_at < cutoff`, and only if no `pending` child row and no retained audit event still references it. A terminal row with missing `completed_at` is ineligible and raises a cleanup diagnostic; do not substitute `created_at` at runtime. Migration 0002 backfills legacy rows' `completed_at = created_at`. `preview` expiry remains the existing separate 15-minute rule. |
| `import_batch_rows` | Per-source-row result, normalized identity, outcome, safe reason, preview action, entity link and timestamps. `payload JSONB` must be present only for `outcome='pending'` and NULL for every non-pending outcome. | `batch_id → import_batches.id ON DELETE CASCADE`; unique `(batch_id, source_row_number)`, positive source row check, outcome whitelist. | Import history child rows inherit the eligible parent batch's one-year policy; never independently delete rows for an arbitrary row timestamp. Keep live/pending rows. | Delete only through an eligible parent batch so FK integrity and batch-level atomicity are preserved. Worker clears pending payload on each terminal outcome. Never log or copy payload into job evidence. |
| `admin_activity_logs` | Admin action, entity type/ID, JSONB details, timestamp. Current call sites include login/logout and bootstrap audit evidence. | `admin_id → admins.id ON DELETE SET NULL`; created-time index. | Approved admin operational/audit history; one year applies. | `created_at < cutoff`, in bounded ID-keyset chunks. If admin is explicitly deleted, FK nulling is independent of retention. |
| `inventory_audit_events` | Actor snapshot, entity ID and inventory-number snapshots, create/update/delete action, `changed_fields` JSONB and timestamp. The JSON may include before/after inventory coordinates/address where inventory fields changed. | Actor FK uses `ON DELETE SET NULL`; `import_batch_id → import_batches.id ON DELETE SET NULL`; indexes by creation time and entity snapshot. No FK to `light_points`, so delete history survives inventory deletion. | Approved inventory audit history; one year applies. It is asset/inventory audit data, not citizen report history. | `created_at < cutoff`, delete before an eligible parent import batch, bounded chunks. Do not purge `light_points` with these events. |
| `schema_migrations` | Runtime ledger of canonical migration version, name, source checksum and applied timestamp. | Version primary key; created by migration runner, not a checked-in `CREATE TABLE` migration. | System metadata; no one-year retention. Preserve for startup and release integrity. | No automatic deletion. |

The production `grant-application-roles.sql` allowlists the existing schema tables/sequences and assigns application object ownership to `lighting_migrator`; it grants `lighting_runtime` only operation-specific permissions. The listed nine application/ledger tables are the complete table set found in these canonical migrations. Database catalog/extension-owned objects are not application retention categories.

**Volume/growth unknowns:** current production row counts, DB bytes, audit/import frequency, typical and worst import rows, WAL rate, and row-size distribution are **not determined from the repository**. The checked-in import upload limit bounds raw bytes at 5 MiB, but the parser and upload configuration show no explicit source-row count cap. Future retention must not assume that one import batch has a small or fixed number of child rows.

## 5. Retention execution design

### 5.1 Deterministic cutoff

**PROPOSAL:** one retention run captures `run_started_at_utc` once from the database, executes `SET TIME ZONE 'UTC'`, and derives one fixed cutoff as the UTC calendar-year anniversary before that instant. Delete rows with timestamp strictly `< cutoff`; equality remains until a later run. Use the same cutoff in every chunk and in the run manifest so a retry cannot drift while it is running. This is a calendar year, not a silently assumed fixed 365-day duration.

At run start, acquire a dedicated PostgreSQL advisory lock (different namespace/key from the import worker and migration runner). If another retention run owns it, exit as `skipped_overlapping` without work. Use `statement_timeout`, `lock_timeout`, bounded transaction sizes, oldest-first keyset scans, and explicit `ON_ERROR_STOP`; on a failed transaction, rollback that chunk, record a secret-free failure, and retry from the same cutoff on the next scheduled run. Re-running the same cutoff is idempotent because already-deleted IDs are absent.

### 5.2 Deletion order and safety predicates

1. Delete eligible `admin_activity_logs` by primary-key chunks (proposal: at most 500 rows per transaction), using `created_at < cutoff`.
2. Delete eligible `inventory_audit_events` by primary-key chunks (proposal: at most 500 rows per transaction), using `created_at < cutoff`. Record only count and duration, not row values.
3. Select the oldest `import_batches` that are terminal and have `completed_at < cutoff`. Exclude `preview`, `queued`, `processing`, NULL `completed_at`, any batch containing `outcome='pending'`, and any batch still referenced by a retained `inventory_audit_events` row. Delete one eligible parent per transaction so its `import_batch_rows` cascade occurs atomically with the parent; do not separately remove or partially expose child rows. Record deleted parent and cascaded-child counts only. A referenced audit event is retained rather than severed merely to force parent cleanup.
4. Separately delete `admin_refresh_sessions` in bounded chunks where `expires_at < run_started_at_utc`. Revoked but not-yet-expired sessions may be retained until their existing expiry; no valid session is removed early.
5. Do **not** delete `integration_logs` until its owner classification is closed. Never delete `light_points`, `admins`, or `schema_migrations` through retention.

An expired parent with a retained linked audit row, a terminal parent with NULL completion time, or a pending child is counted as a cleanup exception/backlog, not force-deleted. The admin history/audit UI currently reads these tables without an annual cutoff; retention intentionally makes old items disappear through actual deletion, not via different UI behavior.

### 5.3 Bound on import-history work

Deleting one parent per transaction protects cross-batch locking and gives atomic parent/child removal, but cascade size is not bounded by the current code: a 5 MiB upload cap is not a row-count cap. **Implementation prerequisite:** before enabling import-history deletion, demonstrate a safe maximum batch cardinality on the target-class disposable database and enforce a deterministic admission bound or another tested, non-partial per-batch deletion approach. If the bound/transaction budget is exceeded, the cleanup must rollback that parent, preserve all rows, emit an actionable backlog alert, and continue other tables/batches. Do not replace this with child-row chunk deletion that leaves a partially visible batch unless a separately designed state/filter makes such partial expiry safe. This technical prerequisite does not block backup/restore planning or non-import retention.

### 5.4 Backups and copies of expired rows

The proposed 30-day backup window is separate from the one-year operational data policy. A row deleted from the live DB may remain in older encrypted backup generations until those generations expire (up to the backup retention window after deletion). Restoring a valid older snapshot can therefore reintroduce rows now past the annual cutoff; that does not make the snapshot inconsistent or prevent recovery. Therefore:

- keep backup lifecycle and database retention metrics separate;
- restore and make service recoverable without waiting for annual retention implementation or execution; only after recovery, run retention as a separate post-recovery operation if that implementation exists and is independently approved;
- do not issue ad hoc `DELETE` statements during disaster recovery. If an owner/legal requirement is that no expired row may ever be served after restore, that is a separate decision and recovery acceptance gate; this plan does not assume it;
- do not promise immediate erasure from all backup media;
- **OWNER/LEGAL CONFIRMATION REQUIRED** if a future erasure/legal-hold request conflicts with immutable backup generations, or if backup-copy expiry requires a different period.

### 5.5 Cleanup evidence

For each daily run, retain: run UUID, UTC start/end, cutoff, code/build revision, migration head, per-table candidate/deleted/deferred counts, chunk count, elapsed time, lock/statement timeout counts, final exit state, and alert delivery status. Do not record usernames, inventory numbers, payloads, row contents, token values, connection strings, or SQL bind values. A successful run with deferred expired rows is `success_with_backlog`, not clean success.

## 6. Backup strategy and RPO

### 6.1 Primary approach

**PROPOSAL:** one complete custom-format logical dump per database using PostgreSQL 16 `pg_dump -Fc`; no `-j` parallelism on the initial 2-vCPU/4-GB target. The archive includes schema, data, sequence state, and extension declarations represented by the database dump. It does not save cluster-global role definitions/passwords; those are provisioned separately from the repository's controlled role scripts and out-of-band secret store. The custom format is compressed and supports selective/reordered restore via `pg_restore` ([`pg_dump`](https://www.postgresql.org/docs/16/app-pgdump.html), [`pg_restore`](https://www.postgresql.org/docs/16/app-pgrestore.html)).

| Approach | Fit for current approved topology | Decision |
|---|---|---|
| `pg_dump -Fc` on six-hour schedule | Single app DB, no stated PITR requirement tighter than 24h, moderate pre-production scope, portable restore, simple operation; target DB size and 4h restore still require measurement. | **Recommended primary.** |
| Physical/base backup plus archived WAL/PITR | Enables recovery to a point between base backups, but needs continuous, gap-free WAL archiving, base-backup lifecycle, WAL monitoring, restore complexity and more storage/operations. PostgreSQL explicitly describes the added complexity and archive continuity requirement ([continuous archiving/PITR](https://www.postgresql.org/docs/16/continuous-archiving.html)). | Not selected for this checkpoint. Reconsider only if measurements or business recovery needs show logical dump cannot meet RTO/RPO. |
| Both logical and physical/WAL | Redundant capability with additional retention, monitoring, disk and operational failure modes. | Not justified by current repository evidence. |

The cadence meets the target only when a complete, encrypted, uploaded, integrity-checked artifact has a recorded snapshot time. A configured interval is not itself evidence of RPO compliance. Full-VM failure additionally requires a documented replacement-host path; DB archive tooling alone cannot establish RTO.

### 6.2 Schedule, success and retries

- Schedule: 00:00, 06:00, 12:00, 18:00 UTC daily through `systemd` timer (`OnCalendar`) with persistent catch-up after reboot. Missed runs coalesce into one immediate current backup after the host is healthy; do not replay four stale full dumps.
- One lock prevents concurrent dump pipelines. A long-running backup causes the next slot to be marked skipped/overlap and alerts; it must never spawn a second dump on a 2-vCPU host.
- On failure: one bounded retry after 15 minutes; if still failing, emit immediate critical failure and do not loop indefinitely. The next scheduled run may proceed only after the prior process/lock is confirmed exited.
- Define a routine backup upload as complete only after: source snapshot acquired; `pg_dump` exit code is 0; encryption and upload both exit 0 under `pipefail`; ciphertext length is nonzero; remote object is committed under a unique immutable key; upload-bound completion metadata or narrowly scoped metadata for that exact object confirms remote size/checksum; and the manifest is written last. The writer must not list or read unrelated objects, download/decrypt artifacts, delete generations, or administer storage. If the destination offers neither trustworthy upload-bound integrity metadata nor exact-key metadata/HEAD, that artifact cannot be marked complete. No manifest with `status=complete` means no successful backup.
- A newest verified snapshot age >18 hours is a warning and signals reduced RPO margin. Exactly 24 hours is a critical operational boundary with no remaining margin; the next instant beyond it is noncompliant. A measured RPO >24 hours is an actual requirement violation; exactly 24 hours remains at the accepted limit. Alert at age ≥24 hours so the boundary is not missed. Alert immediately on any scheduled job's final failure, integrity/decryption failure, or missing manifest even before the age threshold is crossed.
- Backups retain 30 calendar days as the initial proposal (four per day → up to 120 artifacts). Remove expired objects through destination lifecycle policy, not writer credentials. Verify how object versioning/noncurrent-version retention is handled before activation.

### 6.3 Snapshot timestamp and measured RPO

Record a source snapshot cutoff, not just upload completion time. Proposed wrapper: before opening an exported snapshot, require an explicitly configured maximum snapshot lifetime (for example, a required `BACKUP_MAX_SNAPSHOT_AGE_SECONDS` setting); if no approved, target-validated maximum is configured, fail closed before acquiring the snapshot. Start a read-only repeatable-read transaction with the backup identity, export a PostgreSQL snapshot, record its UTC transaction-start timestamp, and keep that transaction open while `pg_dump --snapshot=<exported-id> -Fc` runs. Track elapsed age with a monotonic clock through dump completion. Test the exact pinned PG16 client/server behavior and demonstrate the dump uses the exported snapshot before implementation is accepted. The captured transaction start is a conservative lower-bound time for the exported snapshot; record it as the snapshot time used for RPO calculation. If the exact mechanism cannot be proven in disposable integration tests, report a conservative process-start timestamp and do not claim more precise cutoff evidence.

The production maximum duration is not set by this plan. On expiry, terminate `pg_dump` and the associated pipeline, rollback/close the exporter transaction, mark the run failed/incomplete without a complete manifest, release the backup lock, and use only the existing single bounded retry policy. A long-lived exported snapshot retains visibility of old row versions and can interfere with vacuum; target-class validation must measure dump duration and its vacuum, WAL, CPU/RSS, disk and application/import effects. Before activation, record an owner/operations-approved maximum with a safe margin below the six-hour schedule interval. CI must use a short synthetic bound and verify timeout, transaction cleanup, lock release and absence of a complete artifact/manifest.

For each recovery exercise, calculate:

```text
measured RPO = data-loss event time (UTC) − snapshot_time_utc of the newest verified backup known to precede that event
```

For a synthetic test, inject a marked change in a disposable database and establish a controlled failure/cutoff so the restored inclusion/exclusion proves the recovery point. Record detection/declaration time separately from the actual corruption/deletion time. The requirement is measured RPO ≤24 hours: exactly 24 hours is at the limit with no margin; >24 hours is a violation. If an older backup is the last valid copy because a corrupt state was already captured, use the last known-good backup, not the newest artifact blindly.

### 6.4 Consistency with live writes

`pg_dump` takes a consistent database snapshot and does not block concurrent readers/writers, so planned backup does not require stopping HTTP or the import worker ([PostgreSQL 16 `pg_dump`](https://www.postgresql.org/docs/16/app-pgdump.html)). A P3 import is a sequence of row-level transactions, not one whole-batch transaction. The dump may therefore restore a batch in `processing` with some rows already terminal and others pending; each row's inventory mutation, audit event, row outcome, and payload clear are transactionally grouped. On recovery, start the app only after role/ledger validation, then allow the existing worker lease/requeue logic to resume; include this state in restore integration tests. Avoid running schema migrations concurrently with a dump; release orchestration takes a verified pre-migration dump first.

## 7. Encrypted off-host storage and artifact evidence

### 7.1 Destination contract and unresolved selection

**PROPOSAL:** encrypted object storage in an account/region independent of the production VM. An independent SFTP/SSH host is acceptable only if the organization already operates one with equivalent availability, access controls, lifecycle and restore bandwidth. No repository evidence selects either. Exact provider/account/region, data-residency terms, cost/budget, lifecycle/versioning, credential issuance and endpoint egress are **INFRASTRUCTURE DECISION REQUIRED**. Do not create an external account as part of this plan.

Provider-neutral object contract:

- unique, immutable object key per UTC snapshot and random run ID; never overwrite “latest” in place;
- HTTPS/TLS transport; client-side encryption before the object client receives bytes; provider encryption-at-rest as defense in depth where supported;
- writer can create a new object and upload its manifest, but cannot read/decrypt, list unrelated objects, change lifecycle, or delete generations. To verify an upload, prefer trustworthy completion metadata bound to that upload; otherwise allow only narrowly scoped size/checksum metadata or HEAD for the exact object key. Do not grant broad listing, object download/read, delete or account administration for verification. If the chosen provider cannot provide adequate exact-object integrity evidence within this boundary, do not mark the artifact complete;
- restore identity can read only this backup prefix and cannot write/delete or administer the account;
- lifecycle identity is separate from writer/restore identities and removes only expired generations plus abandoned multipart uploads;
- lifecycle/versioning policy must address noncurrent object versions, incomplete multipart data and deletion evidence;
- enforce destination egress allowlisting or an approved egress proxy on the host. Do not attach the DB dump container to broad provider egress.

### 7.2 Encryption and secrets

**PROPOSAL:** recipient/public-key encryption with an audited, pinned `age` release or compatible implementation. The routine writer has only the public recipient value and cannot decrypt. The private identity is held outside the production VM and outside the backup account's normal admin credential, with at least two independently controlled offline/recoverable custodians per the organization's secret procedure. Use it only in a controlled artifact-verification or restore session; never make it available to the routine backup writer. Losing the identity is equivalent to losing all encrypted backup generations. Rotation must retain old decrypt capability until all generations encrypted to old recipients expire; include old and new recipient IDs in a rotation inventory, never private key material.

Use separate files/secret sources for:

| Secret/material | Routine location/use | Must not be available to |
|---|---|---|
| `lighting_backup` DB password | Read-only dump container secret file, mode-restricted, not CLI argument. | HTTP API, migration service, bootstrap service. |
| Object-store writer credential | Host systemd credential/file or approved file-backed secret mechanism; write-only backup prefix. | DB container, application DB roles, restore-only operators. |
| Age public recipient | Non-secret configuration, versioned with key ID/fingerprint. | No confidentiality requirement; still validate expected recipient. |
| Age private identity | Offline/independent secret store; transient controlled verification/restore session only. | Routine backup writer, routine host job, dump container, repository, job logs. |
| Object-store read credential | Separate restore credential, read-only to backup prefix. | Routine writer and HTTP API. |
| DBA credential | Controlled provisioning/isolated restore only; separate from normal app/maintenance. | HTTP runtime, backup writer, CI secrets. |

`docs/deployment/production-foundation.md` already uses file-backed secrets and expressly excludes secret files from Git. Extend that pattern with distinct maintenance/restore secrets; never add backup secrets to normal backend environment or commit them. Read secrets from protected files/credential APIs, not command-line values; suppress shell tracing for secret-bearing steps and never emit environment dumps.

### 7.3 Integrity, manifest and incomplete uploads

Each run should create an encrypted archive object and then a small, secret-free manifest only after the artifact is committed and verified. Include:

- random `run_id`, opaque logical source DB ID, UTC source snapshot/start/end timestamps;
- PostgreSQL server version, `pg_dump` client version, PostGIS extension version string and canonical migration head/checksum;
- archive format, encrypted object key, encrypted byte count and SHA-256 (or provider-verified checksum), recipient key ID/fingerprint;
- `pg_dump`, encryption, upload, remote-verify and structural-check results; manifest version and code/build SHA;
- no row values, admin names, coordinates, payloads, secrets, URLs with credentials, internal host IPs, or DB connection strings.

For a routine run to pass: all pipeline process exit codes are 0; artifact is nonzero; upload-bound completion metadata or a narrowly scoped exact-object metadata/HEAD check verifies remote byte count and checksum; manifest appears last; and the routine verification succeeds. Do not grant the routine writer broad object listing, object download/read, delete or administrative permissions merely to obtain this evidence. A failed upload leaves no “complete” manifest; unique keys avoid corrupting a prior good generation. If the selected provider cannot return trustworthy upload-bound integrity metadata or exact-key metadata/HEAD without broader permissions, do not mark the artifact complete. Destination lifecycle cleans abandoned multipart uploads and incomplete unreferenced artifacts after a short, fixed grace window. Keep encrypted artifact SHA-256 as integrity evidence; checksum alone is not authenticity, so restrict object-write and manifest identities and verify recipient/key policy.

Before every production schema migration, require a verification record for the same exact immutable backup artifact that will serve as the recovery point. Bind the record to its run ID, object key, manifest ID, encrypted checksum, snapshot UTC and expected recipient/key ID; never combine evidence from different objects. Require successful `pg_dump`, encryption and upload; a complete manifest; verified remote size/checksum; expected key ID; controlled decryption using the recovery identity; and a successful `pg_restore --list` or equivalent PostgreSQL 16 TOC inspection. Also require freshness not beyond the approved warning threshold and a verification record that repeats the artifact identity and records each result, UTC verification time and controlled verifier identity. The routine writer never receives the private decryption key. This is a narrow pre-migration artifact check, not a full restore drill for every migration; full restore drills remain separately scheduled.

The pre-migration gate fails closed if any required evidence is absent, stale, failed, or bound to a different artifact. A record for another run/object/key/checksum/snapshot is not acceptable even if its individual checks passed.

Nightly, select the newest generation and stream it from remote storage through decryption into `pg_restore --list -` (or equivalent TOC parser) without a plaintext file. Run this and the pre-migration gate in a controlled verifier/recovery context with read-only artifact access and the recovery identity, separate from the routine upload writer. This verifies decryptability and archive structure but is not a restore drill. Quarterly restore drills provide end-to-end proof. `pg_restore --list` and input-from-stdin are documented for PG16 ([`pg_restore`](https://www.postgresql.org/docs/16/app-pgrestore.html)).

## 8. Maintenance identities and privilege boundaries

The existing three roles remain the only **application** roles and retain their current boundaries. Normal HTTP continues to use `lighting_runtime`; it must not gain migration, bootstrap, backup, retention, restore, or DBA privileges. The migration role remains controlled one-shot release-only. Bootstrap remains one-shot and temporary.

The requested separate backup/retention behavior needs additional non-application credentials; this is an operational extension, not a change to the runtime role model:

| Proposed principal | Minimum intended capability | Explicitly denied |
|---|---|---|
| `lighting_backup` | LOGIN, NOINHERIT, no memberships, no elevated role attributes; `CONNECT`, schema `USAGE`, `SELECT` on every approved dump object and `SELECT` on required sequences; no table data mutation. | No superuser, `CREATEDB`, `CREATEROLE`, replication, `BYPASSRLS`, DDL, app membership, delete, object storage, or restore authority. Do not grant broad predefined `pg_read_all_data` if an explicit table/sequence allowlist is sufficient. Re-review grants after each migration. |
| `lighting_retention` | LOGIN, NOINHERIT, no memberships/elevation; narrow `SELECT` on only cutoff/status/FK/key columns needed for eligibility plus `DELETE` on approved history tables and expired-session rows. It must not read JSON payload/content unless a query demonstrably needs it. | No `TRUNCATE`, DDL, `UPDATE`, inventory/admin/master deletion, integration-log deletion before owner decision, role management, or storage credential. |
| `DB_ADMIN_USER` / controlled DBA | Fresh-cluster role/extension provisioning and supervised isolated restore/grant application only. | Not mounted in HTTP, backup or retention services; no unattended scheduled DBA login. |

Column-level maintenance SELECT and FK cascade behavior must be verified against the actual SQL in a disposable PG16/PostGIS test. A security-definer function is not the default recommendation; use one only if tests prove a row-level least-privilege SQL routine cannot implement the cleanup safely, and audit its owner/search path/execution grants. Do not add maintenance roles through ad hoc GRANTs or bypass the current fail-on-collision provisioning rules. Extend `database/production/assert-fresh-application-roles.sql`, role scripts and grants deliberately; reserved-role collisions/memberships remain fail-closed.

Restore uses the DBA identity only during a controlled isolated restoration so object ownership/extensions can be reconstructed and then normalized by the canonical grant script. That identity is not reused for routine backup or retention.

## 9. Restore procedure and 4-hour RTO evidence

### 9.1 Restore target and sequence

1. Declare recovery incident and record UTC incident/recovery start, suspected data-loss time, scope, operator and approval. Stop write traffic only if corruption is ongoing or target switch requires it; preserve the source volume/VM when possible for later forensics. Do not run a restore over the only source DB.
2. Provision an isolated replacement/disposable Ubuntu 24.04 target with pinned PG16/PostGIS image and enough measured free capacity. If this is a full VM loss, restore required host config, Docker/Compose, TLS/DNS/proxy and secret access under the infra runbook. That infrastructure procedure is not present in the repository today.
3. Obtain a backup from independent storage using read-only restore credentials. Verify manifest, checksum, expected recipient key ID, and decryptability; decrypt only as a stream or in tightly restricted temporary storage on the isolated target. Never place plaintext archives on the failed/original production disk.
4. Create a fresh empty target DB from `template0`. On a clean replacement cluster, provision application roles with the current fail-on-collision DBA script and protected secrets; on a cluster with preexisting roles, verify exact role provenance/attributes and abort on unexpected state. Provision the required extensions in the target under controlled DBA as current setup requires. Never bypass `assert-fresh-application-roles.sql`.
5. Restore the custom archive under the controlled DBA identity with `pg_restore --no-owner --no-acl --exit-on-error` into the empty target. Do not use `--clean`/drop against an existing target; discard only a failed disposable target. Apply `database/production/grant-application-roles.sql` through the reviewed DBA procedure, which assigns allowlisted table/sequence/function ownership to `lighting_migrator` and restores the explicit runtime/bootstrap grants. This follows PostgreSQL's documented `--no-owner`/`--no-acl` behavior and avoids depending on source-cluster role OIDs/passwords ([`pg_restore`](https://www.postgresql.org/docs/16/app-pgrestore.html)).
6. Run `ANALYZE` on the restored database. Check `SELECT PostGIS_Full_Version()`, inventory count/representative rows, FK/check constraints, sequences, and schema ledger. Compare `schema_migrations` versions/names/checksums against the packaged code without auto-running new migrations. Starting the backend will run `assertMigrationsCurrent`; it does not migrate. If ledger differs, stop and investigate the exact packaged revision; do not silently migrate during restore.
7. Check database integrity and confirm no live import rows were removed by restore itself. Start the backend with only runtime credentials and verify health plus representative admin inventory read/export, import-history, inventory-audit, and authentication/session paths against synthetic test identities/data. Disable provider egress or use an isolated allowlist; no AUSEMIO/CARTO/Geoapify traffic is required. Annual retention is not a prerequisite to making the restored service recoverable; old snapshots may contain rows now past the annual cutoff. Do not issue ad hoc `DELETE` statements during recovery.
8. Record operator approval and exact target config. Switch service traffic only after data/role/ledger/smoke gates pass; this is the RTO endpoint and does not wait for retention. Keep the original source volume or snapshot isolated until the rollback window closes; do not destroy it as part of this plan. If retention is implemented and separately approved, it may run as a distinct post-recovery maintenance operation using its normal tested cutoff/eligibility rules.

The restore default is a fresh target plus `--no-owner --no-acl`, canonical role/grant scripts and explicit validation. PostgreSQL notes that custom archives are portable and `pg_restore` can restore to standard input/target DB; it also warns that restoring a dump executes SQL from the source, so only trusted project-produced artifacts are eligible ([`pg_restore`](https://www.postgresql.org/docs/16/app-pgrestore.html)). Do not rely on a single-transaction restore or parallel jobs until target measurements show they are safe/useful on 2 vCPU/4 GB. If restore fails, never resume a partially restored DB; discard the isolated target and retry from a verified generation after root-cause analysis.

### 9.2 RTO boundary and drill

**OWNER REQUIREMENT:** RTO ≤ 4 hours. **Not yet demonstrated.**

Measure RTO from UTC time the recovery incident is declared and the recovery procedure is authorized to begin to UTC time the restored service is objectively recoverable: expected public/admin origins or the approved isolated equivalent serve requests, backend health checks DB, a runtime-role representative read succeeds, an export/history/audit smoke passes, and operators approve writes/traffic resumption. Include replacement host provisioning/configuration, key retrieval, artifact download/decrypt, database restore, role/grant/ledger validation, app startup and traffic switch. Do not stop the clock when `pg_restore` ends. Annual retention is outside this RTO endpoint and must not block service recovery.

Run at least one full reproducible quarterly drill on target-class infrastructure, then quarterly thereafter. Use synthetic data and a disposable PG16/PostGIS target. Do not access the live DB/provider. Record:

| Timestamp/evidence | Required value |
|---|---|
| Failure/data-loss event UTC and declared drill start UTC | Separate timestamps; identify controlled synthetic event. |
| Backup artifact ID, encrypted checksum, source snapshot UTC | Select verified backup that precedes the synthetic event. |
| Restore start/end UTC | Include fetch/decrypt and DB restore. |
| Validation start/end UTC | Include roles, extension, FK/constraints, ledger and application smoke. |
| Service-recoverable UTC | End of RTO interval as defined above. |
| Measured RPO / measured RTO | `loss_event_time - restored_snapshot_time`; `service_recoverable_time - incident_declared_time`. |
| Environment and resource evidence | PG/PostGIS versions, CPU/RSS, disk/temp/WAL high-water, archive bytes, DB bytes, import queue state. |
| Result | PASS only when RPO ≤24h and RTO ≤4h; otherwise report exact result and corrective work without changing the target thresholds. |

The accepted RTO cannot be claimed for complete VM/disk loss until an independently usable replacement-host, DNS/TLS, secrets and storage-access path is exercised under the same clock.

## 10. Release, migration, rollback and disaster scenarios

### 10.1 Production release ordering

- For every production release with a DB migration, require a passing pre-migration verification record bound to one exact immutable artifact: run ID, object key, manifest ID, encrypted checksum, snapshot UTC and expected recipient/key ID must match across all evidence. That same artifact must have successful `pg_dump`, encryption and upload; a complete manifest; verified remote size/checksum; expected key ID; controlled decrypt with the recovery identity; successful PostgreSQL 16 `pg_restore --list` or equivalent TOC inspection; and snapshot freshness within the approved warning threshold. Keep the resulting verification record tied to that object. The routine writer never has the private decrypt key. Missing, stale, failed or cross-object evidence blocks migration. This gate is not a full restore drill for every migration; restore drills remain separately scheduled.
- Apply canonical forward migration as `lighting_migrator`; record exact app SHA, migration version/checksum, command exit, start/end, and resulting ledger. Apply/review grants as DBA when schema changes need new runtime permissions; do not broaden them by default.
- Deploy the compatible app build, wait for Compose health checks, run targeted read/write smoke, and monitor application/DB errors. Never run migrations from normal HTTP startup.
- A migration with no schema change does not need an extra “before every deploy” backup solely because of release; the pre-migration rule applies whenever production schema mutation is planned.
- There are no safe down migrations in the repo. Roll back the application image only when the prior application is known compatible with the migrated schema. Otherwise stop writes and use a tested forward fix or restore a pre-migration generation to a new DB target; restoring loses all writes after its snapshot. Do not treat container-image rollback as DB rollback.

### 10.2 Operator scenarios

| Scenario | First safe action / writes | Restore or rollback | Resume evidence / data-loss note |
|---|---|---|---|
| A. App/container rollback, DB unchanged | Check DB health/ledger; stop repeated crash loop. Keep DB writes only if compatible backend remains; otherwise put edge in maintenance/read-only mode. | Re-deploy known-good app image only if schema compatibility is confirmed. Do not restore DB for an app-only fault. | Health, expected build SHA, migration ledger accepted by app, representative read/write smoke. No DB data loss expected. |
| B. Broken deployment, DB healthy | Stop further rollout; capture build/migration SHA and sanitized logs. Limit writes if application may be corrupting data. | App rollback only if compatible. If schema/app boundary is incompatible, forward-fix or restore from pre-release backup to isolated target. | Health/route smoke and audit evidence. Restore loses valid writes after snapshot; quantify before switch. |
| C. Accidental DB corruption/deletion | Stop writes immediately to prevent compounding damage; preserve current source volume/snapshot. Record actual damage time and scope. | Restore latest verified generation before damage to a fresh isolated target; validate, then recover service. Annual retention is not a prerequisite; no ad hoc `DELETE` during recovery. A separately approved, implemented retention job may run after recovery. No in-place destructive overwrite. | Integrity checks, ledger, PostGIS, runtime/API paths and operator approval. The snapshot may contain rows now past the annual cutoff without being inconsistent. RPO is measured to actual damage time; subsequent valid writes may be lost. |
| D. Complete VM/disk loss | Declare incident; rebuild from documented base configuration and independent secrets/storage access. | New Ubuntu target, compose, secrets/TLS, restore DB, then app/edge. | Full RTO timer includes host, networking and traffic restoration. If replacement-host/secret path is absent or takes >4h, report RTO target missed; no alternate host/provider is invented here. |
| E. Failed/partial migration | Keep HTTP startup blocked if ledger is not current; stop release, preserve migration logs and backup. Do not apply another unreviewed migration. | Each current migration is transactional in `runMigrations`; verify actual ledger and transaction result. If rolled back, fix cause before retry; if committed and incompatible, app rollback only if compatible, else fresh-target restore/forward fix. | Ledger exact checksum/version, migration exit, preflight evidence and app health. Never create an unsafe down migration. |
| F. Backup destination unavailable | Alert immediately; preserve DB service if healthy. Do not write unencrypted archive as a “temporary backup” on the same 250 GB host. | Retry once per policy, then maintain a failure state and investigate provider/network/quota/credentials. Restore operations may be blocked if no independent copy remains. | Latest verified age, storage health and last known-good key/credential. At exactly 24h, critical boundary/no remaining margin; if measured RPO exceeds 24h, the RPO requirement is violated. Pause risky releases/schema changes. |

## 11. Monitoring and alert contract

No alerting provider or on-call destination is configured in the repository. Start with a provider-neutral structured event and non-zero systemd unit result written to the host journal. The selected external alert receiver, escalation policy and operational owner are **INFRASTRUCTURE/OWNER DECISION REQUIRED**; a local journal is not a delivered alert. Emit a small, secret-free JSON status record with stable `check_id`, UTC timestamp, severity, measured value/threshold, run ID, actionable next step, and component/build SHA. Do not include SQL payloads, row identifiers, coordinates, admin/contact data, secrets or full environment.

| Signal | Source | Proposed threshold | Action |
|---|---|---|---|
| Latest verified backup age | Off-host complete manifest plus nightly decrypt/TOC result | Warn >18h (reduced margin); critical at exactly 24h (boundary/no remaining margin); age >24h is noncompliant. Any final scheduled-run failure/integrity failure is immediately critical. | Retry once; inspect DB access, key ID, object commit/checksum, storage/egress. Pause risky production migrations if no verified restore point. |
| Backup duration / size anomaly | Systemd job duration and encrypted byte size | After 7 successful samples, warn if size <50% or >2× rolling 7-day median for 2 consecutive runs; duration >2× median. Initial samples establish baseline and do not block. | Verify DB/table inventory, upload completeness, import volume and available disk. Do not label anomaly as corruption without validation. |
| Latest encrypted artifact fails decrypt/TOC | Nightly remote-stream verify | Any failure critical. | Quarantine that generation from “latest verified”; check key/transport/archive. Keep previous verified generation. |
| Restore-drill age | Off-host drill evidence record | Warn at >90 days; critical at >120 days. | Schedule target-class restore and update RPO/RTO measurement. |
| Host / Docker-volume free disk | Host `df` plus Docker volume mount accounting | Warn below 50 GiB or 20% of 250 GiB, whichever triggers first; critical below 25 GiB or 10%. | Stop any restore/staging task that could consume disk; inspect PGDATA, WAL, images, logs and incomplete staging. Never run `VACUUM FULL` as an automatic response. |
| PostgreSQL connectivity / container restarts | `pg_isready`, Compose health, backend health; host restart counters | DB unavailable >1 minute critical; >3 DB/backend restarts in 10 minutes warning. | Check host/disk, DB logs, health dependency; stop a bad deployment if correlated. |
| Connection saturation | Read-only aggregate `pg_stat_activity`/`max_connections` observation | Warn >80%; critical >90% sustained 5 min. | Inspect application pool/workers and idle transactions; do not expose SQL text or grant broad stats access without review. |
| Retention run and backlog | systemd result + run record counts | Any failed run immediate; last success >26h warning; expired eligible backlog still present after 24h warning, >7 days critical. | Inspect lock/timeouts, large parent batches and FK references; do not widen deletion. |
| Migration failure | One-shot release command exit / ledger evidence | Any nonzero migration exit immediate critical. | Stop app rollout; preserve pre-migration artifact and logs; inspect ledger before retry. |
| Import worker backlog/error | Current DB `import_batches` statuses and existing admin history | No operations metrics endpoint is configured. Add only aggregate counts/oldest age if needed; never report row payloads. Threshold to be calibrated in implementation. | Inspect worker lock, lease/retry and DB health. This is not a current external alert. |

PostgreSQL statistics views can support aggregate monitoring, but statistics are not a backup/recovery proof; evaluate exact permissions and exposed fields in the implementation tests ([PostgreSQL 16 monitoring statistics](https://www.postgresql.org/docs/16/monitoring-stats.html)). Docker health checks currently do not notify an operator by themselves.

### Operational evidence retention

Keep secret-free backup/retention manifests, daily status summaries, failure/alert records and RPO/RTO drill evidence for **400 days off-host** as an engineering proposal, so evidence covers a full annual retention cycle plus margin. Keep detailed host job logs locally for **90 days**, bounded to **1 GiB** of journald usage; if the cap evicts evidence earlier, the off-host summary/manifest remains the canonical operational record. Record no database content. These are operational evidence lifetimes, not the one-year database row policy or the 30-day backup generation lifetime. Confirm external alert-provider retention and access before activation.

## 12. Scheduling, disk and maintenance behavior

### 12.1 Orchestration comparison

| Option | Assessment on one Compose VM |
|---|---|
| Host `systemd` service/timer invoking one-shot Compose task | **Recommended.** Reboot-aware `Persistent=true`, visible exit status/journal, no always-running privileged scheduler, explicit dependencies and one overlap lock. Host deployment owns the unit. |
| Cron | Works but weaker missed-run/overlap/status semantics and less direct structured service history; not preferred. |
| Long-running scheduler container | Adds a permanent container with Docker/network/secret authority and a second scheduler state to recover; unnecessary for one VM and four daily jobs. |
| Manual operator commands | Useful for controlled restore, not sufficient as the only recurring backup/cleanup mechanism. |

Use separate oneshot units/timers for backup, daily retention and health sampling; do not combine backup and destructive retention into one shell chain. The host execution identity may need Docker socket/root access; Docker control is root-equivalent. Keep the unit short-lived, file permissions restrictive, `NoNewPrivileges`, read-only filesystem where supported, no exposed host DB port, and an explicit egress policy. Do not place a hidden privileged helper in the app container.

### 12.2 Disk/WAL safety

- Stream `pg_dump` stdout through client-side encryption and upload; do not create a plaintext archive on PGDATA, Docker volume, or the same 250 GB disk. Use `set -o pipefail`/equivalent and capture every pipeline process status; never mark success based only on uploader exit.
- `pg_dump` runs in a short-lived container attached only to `db-private`, with `lighting_backup` and PG16 client tools. It has no provider egress. The host-side encrypted upload component uses only the storage writer identity and an approved egress route.
- If the chosen destination cannot accept a stream/multipart upload and requires staging, stop before production activation until a separate encrypted scratch location, strict byte quota, free-space guard, cleanup-on-every-exit path, and target-class test are approved. Never fall back to unencrypted same-volume staging.
- Before any local temporary artifact or restore, require a preflight free-space guard. Initial conservative proposal: warning below 50 GiB / 20% free; refuse new staging/restore work below 25 GiB / 10% free; for a restore additionally require free capacity ≥ 1.5× the latest measured source DB allocated size, and require post-restore projected usage below 80%. These multipliers are guardrails to validate, not proof the 250 GB disk is sufficient. If source DB bytes or peak restore/WAL space are unknown, do not start an in-place production restore.
- Monitor PGDATA filesystem use, database bytes, `pg_wal` directory size and growth, container/image/log use, incomplete upload residue, and restore scratch. The selected primary model does not archive WAL, so WAL has no off-host recovery chain and must not grow without alerting. No replication slots or WAL archiver are configured by the current production Compose file.
- Do not report freed OS disk immediately after DELETE. Plain `VACUUM` normally makes space reusable within PostgreSQL, not necessarily returns it to the OS. PostgreSQL recommends routine autovacuum and documents `VACUUM FULL` as table-rewriting, extra-space, `ACCESS EXCLUSIVE` work ([routine vacuuming](https://www.postgresql.org/docs/16/routine-vacuuming.html)). Keep autovacuum enabled; monitor dead tuples and table growth. Run `ANALYZE`/ordinary `VACUUM` only when observations justify it. Do not schedule `VACUUM FULL`, `CLUSTER`, or partitioning in this checkpoint.

The target host has not been measured. Later target-VM validation must collect backup duration, restore duration, CPU/RSS impact, peak temporary disk, source/restored DB size, WAL high-water/growth, retention duration and rows, and API/import latency during backup and deletion. Capacity is unknown until measured.

## 13. CI and implementation evidence plan

All tests use only local/disposable systems. Never use a production DB, real provider, AUSEMIO, or production credentials. Unit mocks alone do not prove PostgreSQL persistence/recovery behavior.

Required implementation validation:

1. **Command/config tests:** validate schedule, image/client major version, source DB identifier, no overlapping run, `pipefail`, fail-closed behavior for missing/expired snapshot-duration limit and free space, timeout cleanup (abort dump, close exporter transaction, release lock, no complete artifact/manifest), status generation, redaction, unique object keys and lifecycle configuration contracts. Use a short synthetic snapshot-age limit in CI.
2. **Disposable PostgreSQL 16/PostGIS backup integration:** seed synthetic inventory/admin/import/audit/session/log rows; run `pg_dump -Fc` with the limited backup role; verify no unauthorized table access, values/sequence state included, snapshot consistency while HTTP writes/import worker run, snapshot timestamp mechanism, and archive integrity. Test failure after dump, encryption failure, interrupted multipart upload, checksum mismatch, manifest-not-written, missing secrets, wrong key ID, retry and overlapping run.
3. **Encryption round-trip:** encrypt a synthetic archive/stream to the test recipient; verify expected key decrypts, wrong key fails, tampered/truncated ciphertext fails, and no plaintext temp file remains. Use synthetic test identities only.
4. **Isolated restore integration:** create a fresh disposable PG16/PostGIS target from `template0`; restore with no-owner/no-ACL under controlled test DBA; apply canonical role/grant scripts; assert owner/grants and no role memberships; verify extensions, FKs/checks, sequence state, exact migration ledger name/checksum, `assertMigrationsCurrent`, `lighting_runtime` representative reads, inventory export, import/history/audit views, backend health, and import worker recovery from a snapshot containing pending rows. Prove the restored service can become recoverable without retention implementation or execution; do not run ad hoc deletes. Keep network egress disabled.
5. **Exact-artifact pre-migration gate:** a valid record passes only when all evidence names the same immutable run ID, object key, manifest ID, encrypted checksum, snapshot UTC and expected key ID, and the artifact has successful dump/encryption/upload, complete manifest, verified remote size/checksum, controlled recovery-identity decryption, successful PG16 TOC inspection and acceptable freshness. Reject wrong key, tampered bytes, checksum mismatch, corrupt TOC, missing or cross-artifact/mismatched verification record, and stale artifact. Confirm the routine writer has no private decrypt key and that this check does not invoke a full restore drill per migration.
6. **Retention PG integration:** exact cutoff boundary (`<` vs `=`), leap-year/calendar-year/UTC and timezone changes, all nine table classifications, `completed_at` precedence, terminal/nonterminal states, missing completion timestamp, pending payloads, expired preview vs annual cleanup, actor `SET NULL`, batch/rows cascade, audit-before-parent order, retained FK reference exclusion, active session protection, expired session deletion, ambiguous `integration_logs` deny-by-default, per-chunk failure/retry idempotency, concurrent import/retention locks, large batch bound, statement timeout, and denial of `DELETE` on `light_points`, `admins`, `schema_migrations`, and unapproved logs.
7. **Least privilege:** connect as backup/retention/runtime/migrator/bootstrap in disposable DB; assert privileges and memberships, including future migration-created objects; ensure maintenance credentials are absent from HTTP and CI has no production secrets.
8. **Monitoring failure paths:** every alert threshold and systemd failure state, missing/old manifest, restore drill overdue, disk warning/critical, connection saturation, retention backlog, migration failure, and alert-delivery failure.
9. **End-to-end drill:** perform actual encrypted backup, remote fetch/decrypt, restore, role grants, ledger/runtime smoke and RPO/RTO calculation on target-class infrastructure. Preserve artifact checksum and timings; do not invent pass results. Full restore drills remain separately scheduled, not part of each migration gate.

When implemented, extend `.github/workflows/ci.yml` only with synthetic/disposable database checks and pinned image/tooling. CI must not receive any real backup/account/DBA secret. A passing SQLFluff/npm report job is not evidence of zero findings; report each artifact's findings separately under the existing informational policy.

## 14. Owner and infrastructure gates

Accepted decisions not reopened: Ubuntu 24.04 / 2-vCPU / 4-GB / 250-GB target; PostgreSQL 16 + PostGIS; private DB/no public 5432; existing `lighting_migrator`, `lighting_runtime`, `lighting_bootstrap` application-role model and runtime separation; RPO 24h; RTO 4h; one-year retention for approved operational-history categories; AUSEMIO on hold; no citizen-report persistence.

The following gates affect only their dependent implementation work; backup/restore design and unaffected retention categories can proceed independently:

| Gate | Status and decision needed | Affected work |
|---|---|---|
| Off-host destination | **INFRASTRUCTURE DECISION REQUIRED:** provider/account/region, contract/jurisdiction, cost/quota, object versioning/lifecycle, independent access boundary, credentials and egress policy. No account was found in repository evidence. | Backup upload, lifecycle, restore bandwidth/key/account setup. |
| Alert receiver and on-call | **OWNER/INFRASTRUCTURE DECISION REQUIRED:** receiver, escalation, acknowledgement, response owner, out-of-hours process. | External alert delivery; local journal/status design can be prepared first. |
| `integration_logs` classification | **OWNER DECISION REQUIRED:** include or exclude generic integration-log JSON/error content from one-year operational history. Current simulated path is technical-only but schema permits generic content; no live DB rows were inspected. | Cleanup of this table only. Until decided: do not delete it. |
| Backup-copy deletion/erasure | **OWNER/LEGAL CONFIRMATION REQUIRED** if privacy/legal erasure or legal hold must override the proposed 30-day immutable backup window. State that old encrypted copies may persist until expiry. | Final storage lifecycle/erasure runbook. |
| Key custodian/recovery | **OWNER/INFRASTRUCTURE DECISION REQUIRED:** offline key custodians, two-person recovery path, rotation authority and emergency access. | Production encryption and actual restore. |
| Replacement-host recovery | **INFRASTRUCTURE DECISION REQUIRED:** how to provision/reach a replacement host and restore TLS/DNS/firewall/file-backed secrets within the accepted 4-hour RTO. No host IaC/rebuild procedure or measured exercise is in this repository. | Full VM/disk-loss RTO acceptance. Does not reopen the RTO target. |
| No expired rows served after recovery | **OWNER/LEGAL DECISION REQUIRED only if this is a product/legal requirement.** A valid older snapshot may contain rows now past the annual cutoff. Current recovery can restore and recover service without annual cleanup; this plan does not promise that expired rows are never served after restore. | Any additional recovery-time data-filtering/retention gate. It does not block the approved recovery path unless the requirement is accepted. |
| Import cascade bound | Technical evidence gate: current code has a 5 MiB byte cap but no row-count maximum. Measure a maximum transaction/cardinality or implement a tested safe cap/atomic cleanup approach before import parent deletion. | Import history retention implementation only. |
| Backup capacity | Technical evidence gate: capture actual DB size, 30-day archive storage, upload duration, restore high-water and 2-vCPU resource impact. | Claiming RPO/RTO/capacity readiness and enabling production schedule. |

Provider and alert gates do not authorize live CARTO/Geoapify or AUSEMIO use. No providers were contacted for this planning checkpoint.

## 15. Implementation phases and dependencies

These are coherent future work phases, not current implementation authorization. Avoid micro-PRs, but keep destructive retention independently reviewable.

| Phase | Scope | Entry/exit evidence |
|---|---|---|
| A — Operations identities and threat boundaries | Add separately provisioned backup/retention credentials, fail-on-collision checks, explicit least-privilege grants and secret-file boundaries while preserving the three app roles. | Disposable PG role tests prove access allowlists, no memberships/elevated attributes, runtime isolation and denial on inventory/master metadata. |
| B — Backup archive, encryption and off-host contract | Implement PG16 custom dump, exported snapshot time, streaming encryption, unique object, integrity manifest and remote verification. | Destination/account/key/egress gates closed; synthetic round-trip and PG integration green; no plaintext file; failure cases red/green evidenced. |
| C — Scheduling and backup state | Host systemd timer/oneshot, retry/overlap behavior, logs/manifest lifecycle, warning after 18h and critical alert at the 24h boundary. | Reboot/missed-run, repeat, concurrency, status and failure notification evidence; CI no real secrets. |
| D — Isolated restore tooling | Fresh target, role/extension provisioning, no-owner/no-acl restore, canonical grants, ledger/health/smoke validation. | Disposable restore integration proves exact roles, PostGIS, ledger and representative paths; egress disabled. |
| E — Target-class restore drill and RPO/RTO | Complete timed recovery on 2-vCPU/4-GB/250-GB class, including host prerequisites and traffic-ready acceptance. | Actual measured RPO ≤24h and RTO ≤4h with retained record; otherwise report target miss, do not overclaim. |
| F — One-year retention cleanup | Daily UTC cleanup with table allowlist, strict cutoff, parent/child order, chunking, bounded import cardinality, least-privilege role and backlog alerts. `integration_logs` stays excluded until owner decision. | **Separate implementation PR and independent audit strongly recommended:** destructive data deletion. Disposable PostgreSQL tests cover every predicate, cascade, boundary, denial and retry. |
| G — Monitoring and alert integration | Connect provider-neutral structured state to the selected alert receiver; DB/disk/connection/retention/import signals. | Alert destination/on-call gates closed, injected failures demonstrably notify and escalation ownership tested. |
| H — Recovery/release runbook | Document production migration pre-check, app-only rollback, fresh-target restore, six DR scenarios, key recovery and traffic switch. | Operator walkthrough with timed tabletop and quarterly drill schedule; no untested down migration. |
| I — CI/runtime and operations acceptance | CI disposable integration, security/permission regression, artifact retention, monitoring scenarios, docs and exact build/test evidence. | Required CI green, static/security artifacts reported accurately, no production credentials, final independent implementation audit. |

Dependencies: A precedes B and F; B and C precede D; D precedes E. Phases A–E can be implemented and validated without F; neither isolated restore nor RPO/RTO recovery evidence depends on retention implementation or execution. E is required before recovery-readiness claims. F is destructive, requires its own separate implementation PR and independent audit, and depends on retention classification plus import-bound/cardinality evidence. G requires alert-receiver decision; H consumes the verified D/E procedures. No phase activates AUSEMIO or live map/geocoder providers.

## 16. Acceptance checklist for future implementation

- [ ] Production DB remains private; no host/public PostgreSQL port is introduced.
- [ ] HTTP remains `lighting_runtime` only; no DBA/migration/bootstrap/backup/retention secret is mounted into backend.
- [ ] PG16/PostGIS image and matching client behavior are pinned and verified.
- [ ] Off-host artifact is client-encrypted, TLS-transferred, integrity checked, uniquely named, and outside VM failure domain.
- [ ] Scheduled 6-hour full backups, bounded retry, no overlap, age alert, and independent decryption identity work through reboot and storage outage.
- [ ] Backup manifest records the actual conservative snapshot time, migration head/checksum, archive hash/size, and no sensitive DB content.
- [ ] Before every production DB migration, one fresh-enough immutable artifact has a complete, same-object pre-migration verification record covering upload-bound/exact-key size/checksum, expected key ID, controlled recovery-identity decryption, and PG16 TOC inspection; the routine writer has no private decrypt key, and the gate is not a full restore drill.
- [ ] Isolated restore applies canonical roles/grants, verifies PostGIS and exact migration ledger, and starts backend without migration side effects.
- [ ] Restore/RTO readiness does not depend on Phase F or annual cleanup. A restored snapshot may contain rows now past the cutoff; retention, if implemented and separately approved, is a distinct post-recovery operation, never ad hoc recovery SQL.
- [ ] RPO/RTO have actual target-class drill measurements, not inferred from cadence or job exit status.
- [ ] Retention only deletes approved categories under a fixed UTC one-year cutoff; protects inventory/admin/system metadata, active sessions, in-progress imports and retained audit references.
- [ ] Import child deletion remains atomic per parent and is bounded by tested cardinality/resource behavior.
- [ ] `integration_logs` is not cleaned until its owner classification is resolved.
- [ ] Cleanup/backup failures and backlog are actionable; no secrets, payloads, row contents or coordinates enter operational evidence.
- [ ] Logs, application retention, backup generations and restore evidence each have separate lifecycle rules.
- [ ] No application provider or AUSEMIO network use is needed for tests/drills.
- [ ] Target-host capacity is reported only from measured evidence; no 250-GB sufficiency claim is inferred.

## 17. Validation performed for this planning checkpoint

The research was static repository inspection on the exact `master` baseline shown above. It did not run database commands, start Compose, make a backup, restore any database, alter schema/migrations, contact an external provider, or access AUSEMIO. Static validation for this planning-only checkpoint is limited to the documentation diff, whitespace/conflict checks and local Markdown link/path checks. Any later implementation requires the disposable PostgreSQL/PostGIS and encrypted restore evidence in [CI and implementation evidence plan](#13-ci-and-implementation-evidence-plan).

## 18. Unknowns

- Current production existence/state, current DB/schema migration version, row counts, PG patch/PostGIS exact runtime version, DB size, volume/mount mapping, free capacity, WAL growth and backup history: **not determined from the repository**.
- Exact off-host storage provider/account/region/contract/cost, usable object lifecycle/versioning, upload bandwidth/egress rules and restore throughput: **not determined from the repository**.
- Actual host build/replacement, TLS/DNS/firewall and file-secret recovery procedure: **not determined from the repository**.
- Alert receiver, escalation and on-call ownership: **not determined from the repository**.
- Whether `integration_logs` is part of the approved one-year history category and the legal treatment of deleted records in backup generations: **owner/legal decisions required**.
- Maximum import rows per upload and safe cascade transaction high-water on the approved target VM: **not determined from the repository**.
- Any measured RPO/RTO or successful production-like restore drill: **none established by this repository checkpoint**.

## References

- Repository production facts: `docker-compose.production.yml`; `docs/deployment/production-foundation.md`; `backend/src/db/migrate.ts`; `backend/src/db/migrations/0001_initial_schema.sql`; `backend/src/db/migrations/0002_p3_postgis_inventory.sql`; `database/production/`.
- Import/session facts: `backend/src/middleware/upload.ts`; `backend/src/services/streetLightsImport.service.ts`; `backend/src/services/importQueueWorker.service.ts`; `backend/src/config/auth.ts`; `backend/src/services/auth.service.ts`.
- PostgreSQL 16 official documentation: [Backup and Restore](https://www.postgresql.org/docs/16/backup.html), [`pg_dump`](https://www.postgresql.org/docs/16/app-pgdump.html), [`pg_restore`](https://www.postgresql.org/docs/16/app-pgrestore.html), [Continuous Archiving and PITR](https://www.postgresql.org/docs/16/continuous-archiving.html), [Privileges](https://www.postgresql.org/docs/16/ddl-priv.html), [Monitoring statistics](https://www.postgresql.org/docs/16/monitoring-stats.html), [Routine vacuuming](https://www.postgresql.org/docs/16/routine-vacuuming.html).
- Encryption implementation candidate: [age upstream project and streaming examples](https://github.com/FiloSottile/age). This is a planning reference, not a selected dependency or provider activation.

---

**Checkpoint state:** `READY FOR INDEPENDENT PLAN AUDIT` — planning only; no implementation, DB mutation, external backup, provider call, or AUSEMIO access occurred.
