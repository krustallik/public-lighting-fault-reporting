# Database Operations Phase B — Offline Backup Producer Implementation

## Status and evidence boundary

**Implementation status: draft on `feature/database-operations-phase-b-backup-core`; exact-head CI and independent result audit are pending.** The Phase B architecture plan was approved and merged in PR #27. This implementation adds a provider-neutral, one-shot producer and a test-only local fake storage adapter. It does not activate production backups or establish restore readiness, off-host durability, RPO/RTO, or capacity.

The implementation follows the approved contract in [`database-operations-phase-b-backup-plan.md`](database-operations-phase-b-backup-plan.md). It uses the disposable PostgreSQL 16/PostGIS integration fixture already established by [`productionFoundation.postgres.test.ts`](../../../backend/tests/integration/productionFoundation.postgres.test.ts), with synthetic roles, credentials, recipient keys, and filesystem storage. **No production database, real storage provider, AUSEMIO, CARTO, or Geoapify is used.** The local Docker daemon was unavailable in the implementation environment, so actual PostgreSQL/age end-to-end results must come from the exact-head GitHub Actions backend job; local PostgreSQL evidence is not claimed.

## One-shot command

Build then run the compiled command:

```sh
cd backend
npm ci
npm run build
npm run backup:once
```

For a development checkout, `npm run backup:once:dev` runs the same command through `tsx`. The command emits one JSON result record to stdout and uses its `exit_code` as the process exit status. Exit contract:

| State | Exit | Meaning |
|---|---:|---|
| `complete` | 0 | Encrypted archive and create-only manifest were written and independently re-read/verified by the local fake. Producer completion only. |
| `skipped_overlapping` | 10 | Backup-only lock was busy; no migration lock, snapshot, dump, or storage operation. |
| `blocked_by_migration` | 11 | Canonical migration barrier was busy; backup lock is released during cleanup, with no snapshot, dump, or storage operation. |
| `preflight_rejected` | 2 | Configuration or required executable/database-version precondition was rejected. |
| `incomplete` | 1 | A producer stage failed; no verified complete result is returned. An archive object may remain orphaned after ambiguous finalization, but no verified manifest is claimed. |

No scheduling, retries, production-ready default timeout, or recovery command is included.

## Test-only configuration and secret boundary

The CLI requires all of the following before it connects to PostgreSQL:

| Variable | Purpose / constraint |
|---|---|
| `BACKUP_TEST_MODE=true` | Explicitly enables the offline-only CLI path. |
| `BACKUP_STORAGE_ADAPTER=local-fake` | Selects the sole adapter compiled into this checkpoint. |
| `BACKUP_DB_HOST` | Must be the numeric loopback address `127.0.0.1` or `::1`; names and remote hosts are rejected. |
| `BACKUP_DB_PORT` | PostgreSQL port. |
| `BACKUP_DB_NAME` | Existing disposable database name. |
| `BACKUP_DB_USER=lighting_backup` | Read-only maintenance identity only. |
| `BACKUP_DB_PASSWORD_FILE` | Path to a protected file; POSIX mode must have no group/other permissions. Password is copied to a private temporary `PGPASSFILE` (directory `0700`, file `0600`) for `pg_dump` and removed during cleanup. A direct password environment variable is rejected. |
| `BACKUP_MAX_SNAPSHOT_LIFETIME` | Required positive integer milliseconds; no production value is selected. Tests use short synthetic values. |
| `BACKUP_AGE_RECIPIENT` | Public age recipient only. The writer rejects `AGE_IDENTITY` and `AGE_IDENTITY_FILE`; private test identity is used by the separate integration-test decrypt/restore process only. |
| `BACKUP_LOGICAL_DATABASE_ID` | Non-secret stable logical database label for the manifest. |
| `BACKUP_STORAGE_NAMESPACE_ID` | Non-secret namespace label for fake-object identity. |
| `BACKUP_FAKE_STORAGE_ROOT` | Must be a child of the OS temporary directory; it is a local test artifact directory, not a production or off-host store. |
| `APP_BUILD_SHA` | Validated build identifier included in result/manifest. |
| `BACKUP_AGE_BINARY`, `BACKUP_PG_DUMP_BINARY` | Optional executable paths for isolated failure injection; defaults are `age` and `pg_dump`. |

The command rejects inherited runtime/DBA/migrator/bootstrap/JWT/AUSEMIO/Geoapify credentials and age identities. The command and the local fake adapter both fail closed when `NODE_ENV=production`, before database connection/snapshot. Production Compose does not provide backup-only credentials or fake-storage configuration, and this checkpoint does not add a backup service/profile. The fake adapter has no list, arbitrary read, delete, lifecycle, or administration API. It checks exact object version identity against its finalized-object state, then independently reads the finalized file and recomputes byte count and SHA-256; this validates the test adapter only, not a future provider.

## Producer and coordination flow

`backend/src/scripts/backupDatabase.ts` validates test-only configuration, constructs the single `lighting_backup` pool and fake adapter, handles SIGINT/SIGTERM with an abort signal, and prints the stable result. `backend/src/backup/runner.ts` performs executable/version preflight, creates a protected temporary pgpass file, then:

1. Acquires backup lock `(1701669235, 4)`.
2. Acquires the exact shared migration lock `(1701669235, 3)` from [`advisoryLockIds.ts`](../../../backend/src/db/advisoryLockIds.ts), after the backup lock. The existing migration runner imports that same constant from [`migrate.ts`](../../../backend/src/db/migrate.ts).
3. Starts `REPEATABLE READ READ ONLY`, exports one snapshot, and reads PostgreSQL/PostGIS metadata and ordered `schema_migrations(version, name, checksum)` inside that transaction.
4. Runs PG16 `pg_dump --no-password --snapshot=… --format=custom --no-owner --no-privileges`; connects as `lighting_backup` through the private pgpass file.
5. Streams the custom dump directly through age encryption and a bounded Node stream pipeline into `LocalFakeStorageAdapter`. No plaintext custom archive is staged by the writer.
6. After pg_dump completes, commits the exporter transaction and releases the migration barrier. The backup-only lock remains held through encryption, upload finalization, stored-byte re-read, manifest publication, and manifest re-read.
7. Publishes the immutable versioned JSON manifest last, with the run ID, exact fake object identity, SHA-256/byte count, public-recipient key ID, snapshot time, snapshot-bound ordered ledger, source versions, build SHA, and result fields. It contains no database row contents, direct credentials, or private identity.

The manifest schema is defined in [`manifest.ts`](../../../backend/src/backup/manifest.ts); the minimal writer-only adapter contract is in [`storage.ts`](../../../backend/src/backup/storage.ts); local create-only behavior and injectable failure points are in [`localFakeStorage.ts`](../../../backend/src/backup/localFakeStorage.ts).

## Test and toolchain evidence

- Unit tests: `backend/tests/unit/backupCore.test.ts` cover fail-closed configuration, mandatory lifetime, loopback/role gates, ordered migration-ledger validation, create-only collisions, independent re-hash, corruption detection, partial cleanup, ambiguous-orphan behavior, and fake manifest writes.
- PostgreSQL integration acceptance: `backend/tests/integration/productionFoundation.postgres.test.ts` adds tests gated by `PHASE_B_BACKUP_POSTGRES=true` and the existing disposable PG16/PostGIS fixture. It exercises actual `lighting_backup` privileges, unreadable migration-ledger rejection before storage creation, exported-snapshot behavior under a concurrent insert, archive restore from an age-to-`pg_restore` pipe, snapshot ledger equality, both lock directions, backup overlap, lock release timing, future ungranted table failure, synthetic age wrong-key/truncation failures, upload/finalize/remote-integrity/manifest failures, process exit propagation, cancellation, timeout, and exporter disconnect cleanup.
- CI uses the existing digest-pinned `postgis/postgis:16-3.5` service and PostgreSQL 16 client. It installs the upstream age `v1.3.2` Linux amd64 archive only after verifying SHA-256 `cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10`; no npm dependency or package-lock change is introduced.
- The production backend image smoke check invokes the compiled backup CLI with `NODE_ENV=production` and requires `preflight_rejected / production_backup_adapter_not_configured` before it can connect to a database.
- Local validation results and exact-head CI run/job results are recorded below after validation. CI green informational dependency-audit or SQLFluff report jobs are not evidence of zero findings.

## Validation record

| Check | Evidence |
|---|---|
| Backend build | PASS locally (`npm run build`). |
| Backend test-source typecheck | PASS locally (`npm run typecheck:tests`). |
| New backup unit tests | PASS locally: 8/8 (`npm run test -- tests/unit/backupCore.test.ts`). |
| Full backend suite | 203 passed, 1 failed, 38 skipped. The failure is the existing Windows service-area artifact/provenance issue: [`serviceArea.test.ts`](../../../backend/tests/unit/serviceArea.test.ts) returns `unavailable`, and `npm run check:service-area` reports an invalid source-provenance manifest/committed source checksum. This unrelated portability issue was not changed. |
| Backend PG16/PostGIS integration tests | Pending exact-head CI. Local Docker daemon, `pg_dump`, `pg_restore`, and age tools are unavailable; no local PG integration run is claimed. |
| Production fail-closed CLI smoke | PASS locally on the compiled command: with `NODE_ENV=production`, it returns exit 2 and `production_backup_adapter_not_configured` before database configuration/access. Production-image CI smoke remains pending. |
| `git diff --check` | PASS locally. |
| Exact-head GitHub Actions | Pending publication. Required jobs: `frontend`, `backend`, `process-egress-research`, `browser-e2e`, `dependency-audit-report`, `sqlfluff-report`. |
| Independent implementation/result audit | Pending. |

## Explicitly not proven / future gates

- No real off-host provider, account, region, credentials, object version/checksum/create-only semantics, or egress policy is selected or implemented.
- No production key or private-key custody/recovery decision is made.
- Fake stored-byte verification is not provider integrity evidence. Producer `complete` is not a decryptability, recovery, full restore, or RTO claim.
- Target-class capacity (Ubuntu 24.04, 2 vCPU, 4 GB RAM), backup snapshot maximum, representative workload impact, RPO/RTO, restore readiness, retention, legal hold/deletion, scheduling/retries, and monitoring remain later gates/phases in the approved plan.
- No production DB/schema/migration, Compose/runtime behavior, application route, AUSEMIO, or live provider was changed or accessed.

**Checkpoint result:** implementation validation and exact-head CI pending; not ready for independent result audit until required checks pass and evidence is recorded.
