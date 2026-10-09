# Database Operations Phases C–G — Integrated Offline Implementation

**Status:** implementation draft; production activation remains **OFF**. The code is constrained to local/disposable PostgreSQL and the existing Phase B local fake storage. No production provider, storage account, key, DB, or timer has been enabled.

**Canonical parent plan:** [Database Operations, Recovery, and Retention Plan](database-operations-recovery-retention-plan.md).
**Phase B contract and implementation:** [Phase B backup plan](database-operations-phase-b-backup-plan.md) and [Phase B implementation checkpoint](database-operations-phase-b-implementation.md).
**Product boundary:** AUSEMIO remains on hold; public report service `2` / VO only; service `16` / CSS remains out of scope; automatic inventory geocoding remains off.

## 1. Integrated architecture

The offline flow uses one versioned `OperationsRecordV1` envelope (`backend/src/operations/contracts.ts`) for durable status records and keeps the immutable backup identity in the existing Phase B `BackupManifestV1` (`backend/src/backup/manifest.ts`). C serializes scheduled Phase B producer calls; D validates and restores an exact manifest/archive pair to a fresh loopback-only database; E drives a synthetic loss/restore drill; F runs separately under its own PostgreSQL lock; G evaluates supplied aggregate observations into secret-free events.

```text
systemd reference timer
  → fixed offline command (`backend/src/scripts/databaseOperations.ts`)
  → scheduler lock + durable attempt journal
  → Phase B runner + local fake immutable storage
  → exact manifest/archive identity
  → controlled fresh-database restore
  → synthetic loss / measured CI RPO and RTO
  → secret-free evidence and monitoring checks

retention: independent one-shot command and lock; it is not part of restore
or the backup chain.
```

`database/operations/systemd/*.in` are reference templates only: they have no install target and are not installed or enabled. The production command exits before configuration, database, storage, or traffic access while the production adapter is unapproved. No current template constitutes a production activation path.

## 2. Phase C — scheduling and attempt history

`backend/src/operations/scheduler.ts` selects the latest due UTC slot at `00:00`, `06:00`, `12:00`, or `18:00`, so missed slots coalesce and are not replayed. It recomputes the slot after acquiring the scheduler session advisory lock `(1701669235, 6)`. One active producer is allowed. A failed or crashed attempt can have at most one retry after 15 minutes; the journal records the original slot for a crash and a later current slot proceeds independently.

The scheduler calls the Phase B `runBackupOnce` with its run ID (`backend/src/backup/runner.ts`) and does not fabricate an artifact identity when the producer throws or returns a mismatched run ID. The existing backup lock `(1701669235, 4)` and migration/schema barrier `(1701669235, 3)` remain in force.

`backend/src/operations/fileSchedulerJournal.ts` uses append-only JSONL, `fsync`, private directory/file modes on POSIX, strict event/backup-result field validation, a 64 KiB per-event limit, and a 16 MiB total limit. An unterminated last record is ignored because a producer cannot start until its start event is synced. A corrupt or over-limit journal blocks new work. Rotation/archival of a full journal is not implemented; reaching the cap requires operator review rather than deleting evidence automatically.

The six-hour backup and daily retention/monitor timers are reference templates under `database/operations/systemd/`. The backup service has a 15-minute restart delay and a two-start systemd limit; application state independently caps attempts at two per slot. These templates are not production-ready units: credentials, approved host invocation/package, real storage adapter, and activation gates remain absent.

## 3. Phase D — controlled exact-artifact restore

`backend/src/operations/controlledRestore.ts` rejects production mode and non-numeric/non-loopback DB hosts. It requires an exact manifest object identity, validates namespace/version/manifest fields, verifies ciphertext identity, byte count and SHA-256, and checks the expected age recipient ID before creating a target. The restore target name is generated internally and is always a new database; the source DB is never overwritten.

The restore pipeline streams the exact encrypted object through the pinned age decryptor and PostgreSQL 16 `pg_restore --no-owner --no-acl`. It verifies the recovery identity file boundary, writes a private temporary `PGPASSFILE`, terminates child processes at the configured deadline, and removes the temporary credentials. It reapplies the canonical role grants, then checks current migrations/ledger, PostgreSQL/PostGIS, validated foreign/check constraints, all current schema sequences, a runtime query, and required caller-supplied representative data checks. Any failure drops the fresh target and reports whether cleanup was confirmed; no successful receipt is returned for an unconfirmed cleanup.

The test-only read side (`getExactIdentityForRestore`, `readManifestForRestore`, `openArchiveForRestore`) is on `LocalFakeStorageAdapter`; it is not part of the Phase B writer adapter and refuses production mode. The offline integration callback verifies restored inventory, admin history, a queued import and pending row, and their audit linkage.

## 4. Phase E — synthetic recovery drill

`backend/src/operations/recoveryDrill.ts` requires a complete producer result, confirmed synthetic loss time after the captured snapshot, and a restore receipt bound to the same manifest ID, encrypted hash, and snapshot timestamp. It records UTC stage times and computes:

- `synthetic RPO = synthetic loss time − restored snapshot time`;
- `synthetic RTO = restore completion time − synthetic loss time`.

The 24-hour / 4-hour comparison is explicitly labeled `synthetic_ci`. The restored DB is disposed in `finally`; failed disposal fails the drill instead of returning a pass. A synthetic CI result is not target-class measurement or production recovery readiness. The approved Ubuntu/CPU/RAM/disk target, replacement-host path, DNS/TLS/secrets, capacity and full traffic restoration remain untested.

## 5. Phase F — bounded retention core

`backend/src/operations/retention.ts` uses one UTC run timestamp and UTC calendar-year anniversary cutoff (leap-day clamp), with strict `< cutoff`. It takes a separate retention session lock `(1701669235, 5)` and processes deterministic chunks of at most 500 rows, capped at 100 chunks per table per run. Each chunk uses its own transaction, lock/statement timeouts, rollback on chunk failure, and idempotent retry behavior. Earlier committed chunks are retained if a later chunk fails; this is reported as incomplete and retried safely.

The only deletion allowlist is `admin_activity_logs`, `inventory_audit_events`, and expired `admin_refresh_sessions`. Matching narrow `DELETE` grants were added to `database/production/grant-maintenance-roles.sql`; import tables retain no maintenance `DELETE` permission.

Eligible terminal import batches are measured as deferred backlog only. They are **not deleted** because the current schema has no approved/tested maximum child-row cascade bound. Missing completion timestamps, pending child rows, and retained audit references are reported separately. `integration_logs`, `light_points`, `admins`, and migration metadata are never deleted. Backup object deletion/lifecycle is not implemented.

The production retention command and direct retention core both fail closed in production mode. No production or shared development DB retention was run.

## 6. Phase G — monitoring checks

`backend/src/operations/monitoring.ts` is a pure evaluator over a bounded supplied snapshot. It applies the approved recovery-verified backup age policy: warning above 18 hours, critical at 24 hours, requirement exceeded above 24 hours, and immediate critical for a final scheduled backup or integrity failure. It also evaluates recovery-drill age, retention result/backlog, database availability, migration failure, and numeric CPU/RSS/free-disk observations. Malformed, impossible, non-UTC, or future-dated timestamps fail closed. `check_id` is the stable signal component identifier.

`backend/src/scripts/databaseOperations.ts monitor-once` accepts a size-capped JSON snapshot in offline mode, emits structured events and persists aggregate secret-free evidence. No DB/status collector, host resource sampler, alert receiver, escalation/acknowledgement policy, or evidence shipping adapter is implemented. Every event reports `delivery_status: not_configured`; stdout/systemd journaling is not described as a delivered alert. Producer completion alone is not recovery verification; only the explicitly named recovery-verified input is used for the age check.

## 7. Persistence and cross-phase safety

- **No database schema or migration was added.** Persistence uses the existing Phase B manifest and a private local state directory for the scheduler JSONL journal and create-only JSON operation records.
- Operation evidence has a phase-specific field allowlist, timestamp/hash/build-ID validation, a 64 KiB record bound, private file permissions on POSIX, atomic create-only publication, file `fsync`, and directory `fsync` where supported.
- Backup and restore reader code do not place plaintext dumps on disk. The writer receives only the age public recipient; the private synthetic identity is supplied only to the controlled test restore.
- Restore uses a fresh generated DB and cannot target a non-loopback hostname. Failed restore removes the fresh DB; the source is not changed.
- Retention runs independently from backup and recovery. It cannot delete backup objects and cannot delete import history until the cascade bound is proven.
- The code and tests make no AUSEMIO request, provider request, or live geocoding request.

## 8. Validation evidence

### Local Windows worktree

| Check | Result |
|---|---|
| Backend test-source TypeScript check | PASS (`npm run typecheck:tests`) |
| Backend build | PASS (`npm run build`) |
| C–G operations unit tests | PASS: 16 tests; includes slot coalescing/retry/concurrency/crash reconciliation, UTC boundaries, monitoring thresholds, production refusal, journal/evidence limits, and synthetic drill contract. |
| Phase B backup-core regression tests | PASS: 9 passed, 1 platform-specific symlink case skipped on Windows. |
| Full backend test suite | 220 passed, 40 skipped, 1 failed (23 files passed, 5 skipped, 1 failed). The only failure is the existing Windows checkout hash mismatch in `tests/unit/serviceArea.test.ts`: GeoJSON working bytes are CRLF-converted by `core.autocrlf=true`, while the manifest hashes the LF Git blob. Runtime correctly returns `unavailable`. The service-area data, manifest, and portability behavior were not changed. Linux CI is the authoritative check for the committed artifact bytes. |
| Frontend unit tests | PASS: 215 tests across 26 files. |
| Frontend typecheck | PASS: public app, admin app, and test sources. |
| Frontend build | PASS with synthetic build-only CARTO configuration; public/admin graph-boundary checks passed. The public bundle-size warning remains informational. No live tile request was made by the build. |
| Disposable PostgreSQL/PostGIS, age and `pg_restore` integration | NOT RUN locally: Docker client is present but the Docker Desktop Linux engine pipe is unavailable. C–G PostgreSQL integration tests are skipped without the disposable service. The existing GitHub backend job enables `DATABASE_OPERATIONS_CG_POSTGRES=true` alongside Phase B's PG16/PostGIS/age fixture. Remote completion is required before this draft is ready for independent result audit. |
| `git diff --check` | PASS. |

The Phase C–G PostgreSQL tests in `backend/tests/integration/productionFoundation.postgres.test.ts` verify strict retention cutoff/backlog, independent retention lock, 500-row chunk bound/retry, rollback after a synthetic trigger failure, and concurrent scheduler trigger serialization. The adjacent Phase B disposable PostgreSQL integration group also exercises the scheduled backup → synthetic loss → exact restore → monitoring evidence path, restore checksum rejection and timeout cleanup, restored PostGIS/ledger/roles/data. Both groups run only in the disposable PG16/PostGIS CI service.

### Remote evidence

Exact-head GitHub Actions results are pending publication. The backend job must show the PostgreSQL/PostGIS integration cases executed (not skipped); `frontend`, `backend`, `process-egress-research`, and `browser-e2e` are required. Informational dependency-audit and SQLFluff jobs must be reported with their findings; a green report job is not evidence of zero findings.

## 9. Activation matrix

| Area | Current state | Production gate |
|---|---|---|
| Scheduler algorithm, retries, crash journal | Implemented; unit tested locally | Approved Compose-backed host invocation/package; target-host timing, disk and resource evidence; install/enable decision. |
| Backup artifact source | Uses Phase B local fake storage only | Off-host provider/account/region, immutable object/version/checksum semantics, credentials/IAM, egress and cost/quota. |
| Controlled restore | Implemented for fresh loopback disposable DB; integrated test pending CI | Recovery-key custody, target-class capacity, replacement-host/network/secrets and operator traffic switch. |
| Recovery drill | Synthetic CI workflow only | Target-class full recovery measurement; production RPO/RTO and full VM-loss proof. |
| Operational-history retention | Bounded deletion for three approved categories; import batches deferred | Owner/legal retention and backup-erasure decisions as applicable; proven import cascade bound before import deletion; DBA provisioning/grant review. |
| Monitoring | Pure evaluator and local structured output; no collector or delivery adapter | Approved snapshot source/permissions, alert receiver, escalation/acknowledgement and operator ownership; target thresholds for capacity. |

Also unresolved from the approved parent plan: off-host provider/account/region; storage credentials/object semantics; encryption key custody/recovery; target-class capacity; real integrity/egress evidence; restore readiness and RPO/RTO; Phase C activation; Phase F remaining import scope; Phase G monitoring/alert delivery; separate Phase A provisioning-interruption finding; and baseline dependency/SQLFluff findings. These are not resolved by passing synthetic tests.

## 10. Current checkpoint state

Offline implementation exists for all C–G seams. Retention of import batches remains deliberately deferred; monitoring input collection and external delivery remain unimplemented. Production activation is **NOT APPROVED**. Disposable PostgreSQL/PostGIS, age, restore, process-egress and browser CI evidence must pass on the final PR head before requesting the single independent comprehensive result audit. No merge or deployment is part of this checkpoint.
