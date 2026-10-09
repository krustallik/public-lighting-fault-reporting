# Database Operations Phase B — Offline Backup Producer Implementation

## Status and evidence boundary

**Original Phase B implementation:** PR #28 was independently audited and merged. Its final audited PR head was `26b8c15675f9e828a16a8e31ffd898d8ca556316`, exact-head CI was run `37910759575`, merge/master was `a11a6b450ef59816db5b35035f9e9fc51145e070`, and post-merge CI was run `37916557643`; both relevant runs passed all six jobs. Run `37910346073` on `a4bfa59bb04f3e7271752d9887c2ca4ec02d37d1` was an earlier implementation-commit run, not the final PR-head evidence. The Phase B architecture plan was approved and merged in PR #27. The implementation adds a provider-neutral, one-shot producer and a test-only local fake storage adapter. It does not activate production backups or establish restore readiness, off-host durability, RPO/RTO, or capacity.

**Five-P2 hardening status:** PR #29 is merged and independently audited; post-merge validation passed. The final audited PR head was `35ea1453ba29ae05abb2bffaee222a5ee50681c2`; exact-head CI run [37919400551](https://github.com/krustallik/public-lighting-fault-reporting/actions/runs/37919400551), attempt 1, passed all six jobs. It merged at `2026-10-09T11:04:45Z` as master commit `1f2452af790e477c4c23cec543660e78cbac7b96`; post-merge CI run [37921521446](https://github.com/krustallik/public-lighting-fault-reporting/actions/runs/37921521446), attempt 1, passed all six jobs. The independent result audit was PASS WITH P2 (P0=0, P1=0, P2=1); the remaining P2 was final PR traceability, recorded in the sections below. **Phase B offline core/hardening is CLOSED. Production backup activation is NOT APPROVED.** This does not establish production backup readiness or select a real storage provider.

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
- Local, implementation-commit, final exact-head, and post-merge evidence are separated below. CI green informational dependency-audit or SQLFluff report jobs are not evidence of zero findings.

## Original PR #28 validation record — historical

| Check | Evidence |
|---|---|
| Earlier implementation-commit CI | PASS in run `37910346073` on `a4bfa59bb04f3e7271752d9887c2ca4ec02d37d1`; this is historical, not final PR-head evidence. |
| Final audited PR #28 head and exact-head CI | `26b8c15675f9e828a16a8e31ffd898d8ca556316`; run `37910759575`; all six jobs passed. The backend job ran all eight Phase B PG16/PostGIS/age integration cases. |
| PR #28 merge/master | `a11a6b450ef59816db5b35035f9e9fc51145e070`. |
| Post-merge master CI | Run `37916557643`; all six jobs passed. |
| Dependency-audit / SQLFluff | Informational reports only; green status does not mean zero findings. |

## PR #29 implementation-commit evidence — historical

| Check | Evidence |
|---|---|
| Backend build | PASS locally on the hardening worktree (`npm run build`). |
| Backend test-source typecheck | PASS locally (`npm run typecheck:tests`). |
| Backup-core unit tests | PASS locally: 9 passed, 1 platform-specific symlink test skipped on Windows (`npm run test -- tests/unit/backupCore.test.ts`). |
| Full backend suite | Latest local run: 204 passed, 1 failed, 40 skipped. The failure is the existing Windows service-area artifact/provenance issue: [`serviceArea.test.ts`](../../../backend/tests/unit/serviceArea.test.ts) returns `unavailable`, and `npm run check:service-area` reports an invalid source-provenance manifest/committed source checksum. This unrelated portability issue was not changed. |
| Disposable PostgreSQL 16/PostGIS hardening integration | Not run locally because Docker, `pg_dump`, `pg_restore`, and age were unavailable. Implementation-commit run `37918785119` executed all 29 tests in `productionFoundation.postgres.test.ts`; the backend suite passed 257 tests with 1 skipped across 28 files. The real PG16 snapshot/encrypt/restore path passed. New integration cases passed for stalled-create timeout and explicit cancellation (transaction closed, both locks available, no dump child/artifact accepted), zero-ciphertext rejection and cleanup, and migration/backup unlock failures (server sessions closed, locks available to competitors, discarded pool clients not reused, and no false complete result). The create-timeout integration uses a POSIX fake executable and is skipped on Windows; it ran in Linux CI. The same final-head/post-merge evidence is recorded below. |
| Symlink containment | Local unit run passed 9 tests and skipped the platform-specific symlink test on Windows. CI ran all 10 `backupCore.test.ts` tests successfully on Linux, including direct and nested symlink escape rejection and valid temporary-root cases. |
| Production/external access | No production DB/storage, AUSEMIO, or live provider was accessed. |
| Implementation-commit CI | Run [37918785119](https://github.com/krustallik/public-lighting-fault-reporting/actions/runs/37918785119), attempt 1, on implementation commit `052d8d61386769c24c44158a0f739fe8e5b0d290`: all six jobs passed — `backend`, `frontend`, `process-egress-research`, `browser-e2e`, `dependency-audit-report`, and `sqlfluff-report`. This is historical implementation-commit evidence, not final PR-head evidence. Browser E2E passed after process-egress containment proof; the separate egress research job also passed. |
| Dependency audit report | The informational report job completed and uploaded its report; it did not establish zero findings. Frontend report: 2 critical, 5 high, 4 moderate, 0 low. Backend report: 2 critical, 1 high, 3 moderate, 0 low. The merged-master baseline report from run `37916557643` has the same counts, and this PR changes no package manifest or lockfile, so no finding is attributable to a dependency change in this hardening PR. |
| SQLFluff report | The informational report job completed and uploaded its report; it did not establish zero findings. It reports 254 violations across 6 failing SQL files and skips the 53,148-byte `database/seed.sql` because it exceeds the configured 20,000-byte limit. The merged-master baseline run `37916557643` reports the same counts; this PR changes no SQL files. |
| Local and implementation-commit evidence boundary | Local results above describe the implementation worktree. Implementation-commit run `37918785119` is retained as historical evidence and is distinct from PR #29 final-head and post-merge runs below. |

## PR #29 final exact-head evidence

| Check | Evidence |
|---|---|
| Final audited PR head | `35ea1453ba29ae05abb2bffaee222a5ee50681c2`. |
| Exact-head CI | Run [37919400551](https://github.com/krustallik/public-lighting-fault-reporting/actions/runs/37919400551), attempt 1, on `35ea1453ba29ae05abb2bffaee222a5ee50681c2`: success, all six jobs passed — `backend`, `frontend`, `process-egress-research`, `browser-e2e`, `dependency-audit-report`, and `sqlfluff-report`. |
| Independent result audit | PASS WITH P2; P0=0, P1=0, P2=1. The sole P2 was incomplete final PR #29 traceability, closed by this factual checkpoint update; this documentation update is not a new independent audit. |

## PR #29 post-merge evidence

| Check | Evidence |
|---|---|
| Merge state and identity | PR #29 is merged. `merged_at`: `2026-10-09T11:04:45Z`. Merge commit and resulting master: `1f2452af790e477c4c23cec543660e78cbac7b96`. Parents are previous master `a11a6b450ef59816db5b35035f9e9fc51145e070` and audited PR head `35ea1453ba29ae05abb2bffaee222a5ee50681c2`; merge tree equals the audited PR-head tree `bf38e356e74fa86c83cf2c4e62cbe4124c7a780a`. |
| Post-merge master CI | Run [37921521446](https://github.com/krustallik/public-lighting-fault-reporting/actions/runs/37921521446), attempt 1, on master SHA `1f2452af790e477c4c23cec543660e78cbac7b96`: success, all six jobs passed — `backend`, `frontend`, `process-egress-research`, `browser-e2e`, `dependency-audit-report`, and `sqlfluff-report`. |
| Backend results | 28 test files passed; 257 tests passed and 1 was skipped. `productionFoundation.postgres.test.ts`: 29 passed; `backupCore.test.ts`: 10 passed. Disposable PostgreSQL 16/PostGIS, age, snapshot/restore, and backup hardening regression tests ran successfully. |
| Process containment / browser E2E | Both `process-egress-research` and `browser-e2e` passed. The browser job completed the privilege-resistant process-egress containment proof and synthetic browser suite. No AUSEMIO or live-provider traffic was used. |
| Dependency audit / SQLFluff | The informational results remain the same as the recorded baseline above; green report jobs do not mean zero findings. These results are preserved, not reclassified by this closeout. |

**Phase B checkpoint:** offline core and hardening are CLOSED. Production backup activation is NOT APPROVED. Real storage/provider semantics, recovery-key custody, full restore readiness, RPO/RTO, scheduling, and retention are not completed or proven. The separate Phase A provisioning-interruption P2 and Windows service-area portability finding remain unchanged.

## Explicitly not proven / future gates

- No real off-host provider, account, region, credentials, object version/checksum/create-only semantics, or egress policy is selected or implemented.
- No production key or private-key custody/recovery decision is made.
- Fake stored-byte verification is not provider integrity evidence. Producer `complete` is not a decryptability, recovery, full restore, or RTO claim.
- Target-class capacity (Ubuntu 24.04, 2 vCPU, 4 GB RAM), backup snapshot maximum, representative workload impact, RPO/RTO, restore readiness, retention, legal hold/deletion, scheduling/retries, and monitoring remain later gates/phases in the approved plan.
- The separate Phase A provisioning-interruption P2 remains open: role creation commits before interactive password assignment, so interruption can leave reserved role names requiring explicit DBA inspection/resolution. Phase B hardening does not change this provisioning flow.
- No production DB/schema/migration, Compose/runtime behavior, application route, AUSEMIO, or live provider was changed or accessed.

**Checkpoint result (original PR #28):** the offline producer was merged and its post-merge master CI was validated. **Five-P2 hardening:** PR #29 was independently audited PASS WITH P2 (P0=0, P1=0), merged as `1f2452af790e477c4c23cec543660e78cbac7b96`, and post-merge CI run `37921521446` passed all six jobs. The final traceability P2 is closed by this checkpoint update. Phase B offline core/hardening is CLOSED; production backup activation and future provider/key/operations gates remain NOT APPROVED or incomplete. The separate Phase A provisioning-interruption P2 also remains open.
