# Database Operations Phases C–G — Integrated Offline Implementation

**Status:** corrected offline implementation draft; production activation remains **OFF**. The corrected code head `a697b38e18c6ade24e0845dac66740b399441b25` passed GitHub Actions run [`37942131178`](https://github.com/krustallik/public-lighting-fault-reporting/actions/runs/37942131178), attempt 1, all six jobs. PR #31 remains open and unmerged; the live [PR checks](https://github.com/krustallik/public-lighting-fault-reporting/pull/31/checks) track the current documentation-bearing head before independent targeted result audit. The code is constrained to local/disposable PostgreSQL and the existing Phase B local fake storage. No production provider, storage account, key, DB, or timer has been enabled.

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
  → synthetic loss / elapsed CI intervals (not production RPO/RTO)
  → secret-free evidence and monitoring checks

retention: independent one-shot command and lock; it is not part of restore
or the backup chain.
```

`database/operations/systemd/*.in` are reference templates only: they have no install target and are not installed or enabled. The production command exits before configuration, database, storage, or traffic access while the production adapter is unapproved. No current template constitutes a production activation path.

## 2. Phase C — scheduling and attempt history

`backend/src/operations/scheduler.ts` selects the latest due UTC slot at `00:00`, `06:00`, `12:00`, or `18:00`, so missed slots coalesce and are not replayed. It recomputes the slot after acquiring the scheduler session advisory lock `(1701669235, 6)`. One active producer is allowed. A failed or crashed attempt can have at most one retry after 15 minutes; the journal records the original slot for a crash and a later current slot proceeds independently.

The scheduler calls the Phase B `runBackupOnce` with its run ID (`backend/src/backup/runner.ts`) and does not fabricate an artifact identity when the producer throws or returns a mismatched run ID. The existing backup lock `(1701669235, 4)` and migration/schema barrier `(1701669235, 3)` remain in force.

`backend/src/operations/fileSchedulerJournal.ts` uses append-only JSONL, `fsync`, private directory/file modes on POSIX, strict event/backup-result field validation, a 64 KiB per-event limit, and a 16 MiB total limit. An unterminated final record is an uncommitted tail: before any later append, the journal truncates only that tail, syncs the repaired file and directory entry, then appends and syncs the new record. Malformed newline-committed records and over-limit journals block new work. Rotation/archival of a full journal is not implemented; reaching the cap requires operator review rather than deleting evidence automatically.

`database/operations/systemd/public-lighting-backup.timer.in` is a persistent one-minute poll (`Persistent=true`); after reboot it asks the scheduler to reconcile durable state. `retry_at_utc` in the JSONL journal determines when the single 15-minute retry is due, independent of systemd restart state. The application allows at most two attempts per UTC slot, coalesces missed slots, and uses a distinct scheduler lock. Tests cover simulated restart before and after the retry deadline, retry-not-due, a retry crossing a scheduled slot, duplicate triggers, and abandoned attempts. The retention and monitor timers remain daily reference templates. All templates are uninstalled/unenabled and have no `[Install]` section. `systemd-analyze` is unavailable in the local Windows environment; template semantics are checked by unit assertions, not by a systemd runtime verifier.

## 3. Phase D — controlled exact-artifact restore

`backend/src/operations/controlledRestore.ts` rejects production mode and non-numeric/non-loopback DB hosts. It requires an exact manifest object identity, validates namespace/version/manifest fields, verifies ciphertext identity, byte count and SHA-256, and checks the expected age recipient ID before creating a target. UTC timestamp validation accepts the six fractional digits emitted by PostgreSQL `US` formatting as well as JavaScript millisecond timestamps. The restore target name is generated internally and is always a new database; the source DB is never overwritten.

The restore pipeline streams the exact encrypted object through the pinned age decryptor and PostgreSQL 16 `pg_restore --no-owner --no-acl`. It verifies the recovery identity file boundary, writes a private temporary `PGPASSFILE`, terminates child processes at the configured deadline, and removes the temporary credentials. It reapplies the canonical role grants, then checks current migrations/ledger, PostgreSQL/PostGIS, validated foreign/check constraints, all current schema sequences, a runtime query, and required caller-supplied representative data checks. Any failure drops the fresh target and reports whether cleanup was confirmed; no successful receipt is returned for an unconfirmed cleanup.

The test-only read side (`getExactIdentityForRestore`, `readManifestForRestore`, `openArchiveForRestore`) is on `LocalFakeStorageAdapter`; it is not part of the Phase B writer adapter and refuses production mode. The offline integration callback verifies restored inventory, admin history, a queued import and pending row, and their audit linkage.

## 4. Phase E — synthetic recovery drill

`backend/src/operations/recoveryDrill.ts` requires a complete producer result, confirmed synthetic loss time after the captured snapshot, and a restore receipt bound to the same manifest ID, encrypted hash, and snapshot timestamp. It records UTC stage times as `synthetic_snapshot_to_loss_elapsed_ms` and `synthetic_loss_to_restore_elapsed_ms`; the first is compared with the 24-hour synthetic snapshot-to-loss target. The loss-to-restore duration is descriptive synthetic timing only. It is not called RTO and is not compared with the 4-hour target because the drill does not measure incident declaration through service recoverability. The restored DB is disposed in `finally`; failed disposal fails the drill instead of returning a pass. Synthetic CI evidence does not establish target-class measurement or production recovery readiness. The approved Ubuntu/CPU/RAM/disk target, replacement-host path, DNS/TLS/secrets, capacity and full traffic restoration remain untested.

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
| Backend test-source TypeScript check | PASS on corrected code head (`npm run typecheck:tests`). |
| Backend build | PASS on corrected code head (`npm run build`). |
| C–G operations unit tests | PASS: 24 tests, including restart/retry/crash reconciliation, scheduler lock and coalescing, torn-tail repair/fsync failures, retention mode/target guards, synthetic drill identity and labels, and process signal-event relay. The child-process test emits the `SIGTERM` process event directly; OS-originated signal delivery is not established by this test. |
| Phase B backup-core regression tests | PASS: 9 passed, 1 platform-specific symlink case skipped on Windows. |
| Full backend test suite | 228 passed, 40 skipped, 1 failed (23 files passed, 5 skipped, 1 failed). The only failure is the known Windows checkout hash mismatch in `tests/unit/serviceArea.test.ts`: GeoJSON working bytes are CRLF-converted by `core.autocrlf=true`, while the manifest hashes the LF Git blob. Runtime correctly returns `unavailable`. Service-area data, manifest, and portability behavior were not changed. Linux CI is authoritative for committed artifact bytes. |
| Frontend unit tests/typecheck/build | PASS in exact-code CI run `37942131178`; public/admin graph-boundary checks passed. The public bundle-size warning remains informational. No live tile request was made by the build. |
| Disposable PostgreSQL/PostGIS, age and `pg_restore` integration | NOT RUN locally: Docker Desktop Linux engine pipe is unavailable. PASS remotely in exact-code CI run `37942131178` on code head `a697b38e18c6ade24e0845dac66740b399441b25`: `productionFoundation.postgres.test.ts` passed all 37 tests using disposable PostgreSQL 16/PostGIS, age and `pg_restore`. |
| `git diff --check` | PASS. |

The Phase C–G PostgreSQL tests in `backend/tests/integration/productionFoundation.postgres.test.ts` verify strict cutoff, actual PostgreSQL UTC transaction-clock behavior, independent retention lock, unlock failure with client discard/no lock inheritance, 500-row chunk bound/retry, rollback after a synthetic trigger failure, and concurrent scheduler trigger serialization. The cross-phase integration test creates an 8 MiB synthetic random byte value (hex-encoded in the fixture), verifies the decrypted archive stream exceeds 1 MiB, restores through real age and `pg_restore` into disposable PG16/PostGIS, and checks the restored digest. It also covers source timeout, age failure, archive read failure, and fresh-target cleanup. These tests run only in the disposable PG16/PostGIS CI service.

### Remote evidence

**Historical pre-correction evidence:** GitHub Actions run [`37930482064`](https://github.com/krustallik/public-lighting-fault-reporting/actions/runs/37930482064) passed for earlier implementation head `771a617d00338e55fbc181bec0de647a01113ef4`. It is historical evidence only and does not validate the C–G corrections recorded here.

**Corrected implementation code-head evidence:** GitHub Actions run [`37942131178`](https://github.com/krustallik/public-lighting-fault-reporting/actions/runs/37942131178), attempt 1, passed for code head `a697b38e18c6ade24e0845dac66740b399441b25`. All six jobs succeeded: `backend`, `frontend`, `process-egress-research`, `browser-e2e`, `dependency-audit-report`, and `sqlfluff-report`. Backend unit and coverage steps each reported 29 files, 289 passed and 1 skipped; `productionFoundation.postgres.test.ts` passed 37 tests. Browser E2E completed process-egress containment and the browser suite. This code-head run is distinct from later checkpoint-only documentation commits; PR checks validate the then-current PR head.

The dependency artifact reports backend 6 findings (3 moderate, 1 high, 2 critical) and frontend 11 (4 moderate, 5 high, 2 critical). These counts match the master baseline artifact from run `37923964958`; this PR changes no dependency manifests or lockfiles, so the report provides no evidence of newly introduced dependency findings. The green job means the report was collected, not that vulnerabilities are absent. The SQLFluff artifact contains 254 finding rows, including 24 for `database/production/grant-maintenance-roles.sql`, the same file-level count as the baseline; the report job is informational and does not mean lint is clean. The large `database/seed.sql` lint coverage gap remains documented.

## 9. Independent audit correction evidence

| Finding | Status | Code and test evidence |
|---|---|---|
| P1-1 — crash-safe JSONL journal | FIXED | `FileSchedulerJournal` repairs only a torn final tail before append, syncs file and directory entries, and rejects malformed committed records. `operations.test.ts` covers retained committed rows, repair/fsync failure, repeated repair, first-record durability failure, malformed middle records, and size limits. |
| P1-2 — reboot-persistent bounded retry | FIXED | The persistent minute timer polls durable `retry_at_utc`; scheduler permits at most two attempts per slot and keeps a separate advisory lock. Fake-clock tests cover restart before/after deadline, not-due, slot crossing, duplicate triggers, abandoned attempt, and retry exhaustion. |
| P1-3 — restore stream deadlock | FIXED | `controlledRestore.ts` pumps archive→age and age→`pg_restore` concurrently with backpressure and bounded cancellation. The PG16/PostGIS test uses a decrypted payload >1 MiB and validates restored digest; it also exercises injected age failure, injected `pg_restore` early exit, archive read failure, source timeout, and fresh-target cleanup. |
| P1-4 — missing drill evidence | FIXED WITH EXPLICIT UNKNOWN | `monitoring.ts` emits actionable `restore_drill_evidence_missing` with `severity: unknown` when no target-class drill exists or only synthetic evidence exists. Tests cover missing evidence, synthetic-vs-target-class, and the >90/>120-day boundaries. Escalation severity remains an owner policy question. |
| P2-1 — synthetic RTO wording | CLOSED | The evidence fields are elapsed synthetic intervals; no `rto_ms` or 4-hour RTO claim is emitted. Only snapshot-to-loss is compared to the synthetic 24-hour target. Production/target-class RPO/RTO remain unmeasured. |
| P2-2 — restore end-to-end deadline | CLOSED | One deadline/AbortSignal covers restore preflight, source reads, target creation, pipeline, grants, ledger/runtime checks and validation; timeout/failure cleanup drops the fresh target and bounds child termination. Covered in disposable PG16/PostGIS integration tests. |
| P2-3 — SIGTERM process relay | CARRIED — OS DELIVERY UNVERIFIED | The CLI passes the AbortSignal into the scheduled producer; `runWithTerminationSignal` keeps handlers until operation cleanup completes. `operations.test.ts` exercises the real helper in a child process by emitting the process SIGTERM event and confirms abort plus returned code. The OS-originated signal attempt in [run `37941748037`](https://github.com/krustallik/public-lighting-fault-reporting/actions/runs/37941748037) failed: child output reached `operation-ready` and `signal-sending` but never `abort-received`. The passing process-event test therefore does not establish OS signal delivery; add a host-level signal test when the runtime harness permits it. |
| P2-4 — exported retention boundary | CLOSED | `runRetentionOnce()` checks production mode, explicit offline-test mode, actual pool target, numeric loopback host and `_test` database name before connecting. Unit and disposable PostgreSQL tests cover refusal and allowed target. |
| P2-5 — checkpoint traceability | CLOSED | Historical pre-correction run `37930482064` is explicitly separated from corrected implementation code-head run `37942131178`; current PR checks are linked from [PR #31](https://github.com/krustallik/public-lighting-fault-reporting/pull/31/checks). |
| P2-6 — retention PostgreSQL evidence | CLOSED | Run `37942131178` executes the real PG16/PostGIS checks for UTC transaction-clock cutoff, unlock failure/client discard/no lock inheritance, role grants, bounded chunks, rollback and backlog behavior. |
| P2-7 — journal directory durability | CLOSED WITH PLATFORM LIMITATION | POSIX/Linux journal and parent-directory entries are synced on creation and repair; failure prevents producer start. Windows Node does not expose the same directory-fsync contract, so Windows local execution is not evidence for Linux host durability. |

## 10. Activation matrix

| Area | Current state | Production gate |
|---|---|---|
| Scheduler algorithm, retries, crash journal | Implemented; unit tested locally | Approved Compose-backed host invocation/package; target-host timing, disk and resource evidence; install/enable decision. |
| Backup artifact source | Uses Phase B local fake storage only | Off-host provider/account/region, immutable object/version/checksum semantics, credentials/IAM, egress and cost/quota. |
| Controlled restore | Implemented for fresh loopback disposable DB; exercised with actual PG16/PostGIS and age in CI run `37942131178` | Recovery-key custody, target-class capacity, replacement-host/network/secrets and operator traffic switch. |
| Recovery drill | Synthetic CI workflow only | Target-class full recovery measurement; production RPO/RTO and full VM-loss proof. |
| Operational-history retention | Bounded deletion for three approved categories; import batches deferred | Owner/legal retention and backup-erasure decisions as applicable; proven import cascade bound before import deletion; DBA provisioning/grant review. |
| Monitoring | Pure evaluator and local structured output; no collector or delivery adapter | Approved snapshot source/permissions, alert receiver, escalation/acknowledgement and operator ownership; target thresholds for capacity. |

Also unresolved from the approved parent plan: off-host provider/account/region; storage credentials/object semantics; encryption key custody/recovery; target-class capacity; real integrity/egress evidence; restore readiness and RPO/RTO; Phase C activation; Phase F remaining import scope; Phase G monitoring/alert delivery; separate Phase A provisioning-interruption finding; and baseline dependency/SQLFluff findings. These are not resolved by passing synthetic tests.

## 11. Current checkpoint state

Offline implementation exists for C–G. Retention of import batches remains deliberately deferred; monitoring input collection and external delivery remain unimplemented. Production activation is **NOT APPROVED**. Corrected code head `a697b38e18c6ade24e0845dac66740b399441b25` passed all six CI jobs in run `37942131178`; the live PR checks page tracks validation of the current documentation-bearing head. PR #31 remains open/unmerged and awaits independent targeted result audit after current-head checks complete. No merge or deployment is part of this checkpoint.
