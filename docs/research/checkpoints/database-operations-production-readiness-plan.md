# Database Operations Production Readiness Plan

**Status:** planning/research only — previous independent plan audit **PASS WITH P2**. Its documentation-accountability P2 is closed by §11.1; this factual correction is not a new independent audit. Production activation remains **BLOCKED**.
**Verified baseline:** master at `de4d9344e5ffd98962df154a54e806b38bea426b`, checked 2026-10-09.
**Current post-merge evidence:** PR #34 merge commit `de4d9344e5ffd98962df154a54e806b38bea426b`; GitHub Actions [run 37979668773](https://github.com/krustallik/public-lighting-fault-reporting/actions/runs/37979668773), attempt 1, exact merge SHA, all six jobs succeeded. Earlier PR #32 evidence is retained as historical in §15.
**Scope:** one consolidated production-readiness contract for Database Operations A–G. No implementation, provisioning, deployment, provider activation, destructive job, or production access is authorized by this document.

## 1. Executive summary

Database Operations A–G have an integrated offline implementation. PR #32 is historical: it merged as `c06937572889a5e74c88d4cda555e2df954ebaf2` and its own post-merge CI is recorded in §15. Current master includes PR #34, merged as `de4d9344e5ffd98962df154a54e806b38bea426b`; its tree equals the audited PR #34 head tree. Exact post-merge run 37979668773 succeeded on that SHA. Backend CI used disposable PostgreSQL 16/PostGIS; the PostgreSQL integration suite passed, including the restore lifecycle regression, with no unhandled PostgreSQL `57P01` teardown failure in the backend log. These results prove behavior only for committed code and synthetic fixtures.

The production path remains deliberately fail-closed:

- The only backup storage adapter wired into the command is LocalFakeStorageAdapter. It is test-only; parseBackupConfig rejects NODE_ENV=production before database connection.
- databaseOperations.ts rejects production with production_operations_adapter_not_configured. The fixed commands require DATABASE_OPERATIONS_MODE=offline-test.
- Retention also rejects production and any non-loopback/non-test database.
- Controlled restore currently uses the fake exact-object reader and a fresh loopback disposable database.
- Checked-in systemd units are reference templates, not installed/enabled services, and have no Install section. Their production environment reaches the intentional command rejection.
- Production Compose has PostgreSQL 16/PostGIS on an internal Docker network, with no host-published PostgreSQL port. There is no production backup, restore, retention, monitoring collector, or alert-delivery service.

Evidence: [backup/config.ts](../../../backend/src/backup/config.ts), [databaseOperations.ts](../../../backend/src/scripts/databaseOperations.ts), [retention.ts](../../../backend/src/operations/retention.ts), [controlledRestore.ts](../../../backend/src/operations/controlledRestore.ts), [production Compose](../../../docker-compose.production.yml), and [systemd templates](../../../database/operations/systemd/).

This plan preserves accepted A–G architecture, target, RPO/RTO and monitoring rules. It does not select a provider, account, region, custodian, alert receiver or destructive retention rule on the owner's behalf. Approval authority and execution ownership are separated by functional role in §11.1; named assignments remain TBD.

**Current verdicts:** backup storage, scheduling, production restore, target-class recovery, production retention, production monitoring and full production operations are **NOT READY**. Production activation is **NOT APPROVED**.

### Evidence labels

- **REPO VERIFIED** — visible in current tracked source/configuration or cited CI; not a live-host/database observation.
- **OWNER-APPROVED REQUIREMENT** — supplied/accepted constraint; not independently measured.
- **IMPLEMENTED** — present in repository.
- **TESTED OFFLINE** — synthetic, disposable PostgreSQL/PostGIS, fake storage or contained browser execution.
- **NOT IMPLEMENTED** — no production component/behavior found.
- **OWNER DECISION REQUIRED** — product/legal/custody/operations choice cannot be inferred from code.
- **INFRASTRUCTURE EVIDENCE REQUIRED** — host/provider/network/capacity fact requiring demonstration.
- **PRODUCTION ACTIVATION BLOCKED** — prerequisite is open; production use is not permitted.

## 2. Verified A–G architecture and status

Canonical architecture is in the [recovery and retention plan](database-operations-recovery-retention-plan.md), [Phase B backup plan](database-operations-phase-b-backup-plan.md), [Phase B implementation checkpoint](database-operations-phase-b-implementation.md), and [C–G implementation checkpoint](database-operations-phases-c-g-implementation.md). This plan translates those contracts into a production-readiness path; it does not restart the architecture.

| Area | Current implementation and evidence | Production gap |
|---|---|---|
| A — identities/threat boundaries | Separate lighting_backup and lighting_retention roles, provisioning/assertion SQL and explicit grants. Existing app roles remain distinct. See database/production/create-maintenance-roles.psql, assert-fresh-maintenance-roles.sql, grant-maintenance-roles.sql and grant-application-roles.sql. Disposable PG16 privilege tests run in productionFoundation.postgres.test.ts. | No production credential issuance/deployment. Phase A provisioning-interruption P2 remains open (§10). |
| B — producer/artifact | runBackupOnce in backend/src/backup/runner.ts exports a snapshot, runs PG16 pg_dump, streams through age and a narrow adapter, verifies exact identity/hash/size, then publishes a versioned manifest. Only LocalFakeStorageAdapter is wired. | No production object adapter, account/region, credentials, provider checksum/version evidence or egress proof. Producer complete is not recovery readiness. |
| C — scheduling/journal | runScheduledBackup implements UTC 00/06/12/18 slots, coalescing, one retry after 15 minutes, max two attempts, scheduler lock and durable JSONL journal. Journal caps at 16 MiB, validates records and repairs a torn final tail. | No installed/enabled timer, target-host boot/restart behavior or configured durable state path. Journal rotation is absent; a full journal fails closed and needs operator review. |
| D — controlled restore | restoreExactBackupToFreshDatabase validates exact manifest/object identity, checksum/size/key ID, creates a new target DB, streams decrypt to pg_restore, reapplies grants, checks ledger/constraints/sequences/runtime and removes failed fresh targets. Session timeouts are restored or the client is discarded; PR #34 adds and verifies target-session drain before cleanup. | Reader is fake-only. No production read credential, real key custody, provider retrieval, replacement-host procedure or target-class drill. The separate admin-query wall-clock timeout P2 remains open. |
| E — recovery drill | runSyntheticRecoveryDrill binds producer and restore receipts to one synthetic manifest and records UTC intervals. | Synthetic only. No target-class or VM-loss evidence. |
| F — retention | runRetentionOnce uses one UTC timestamp/calendar-year cutoff, strict less-than, a separate lock, bounded 500-row chunks/max 100 chunks per table, per-chunk transactions/timeouts and backlog reporting. Delete allowlist: admin_activity_logs, inventory_audit_events, expired admin_refresh_sessions. | Offline-test-only. Import batches are measured but not deleted; no approved/tested cascade bound. integration_logs is unclassified. Backup expiry is not implemented. |
| G — monitoring | evaluateMonitoring is a pure evaluator on a supplied bounded snapshot; emits secret-free events with delivery_status not_configured. | No production collectors, external receiver, retries, escalation/acknowledgement, evidence shipping or on-call ownership. Journal entry is not an alert delivery. |

**Historical checkpoint wording:** database-operations-phases-c-g-implementation.md contains PR #32 open/unmerged wording from its earlier checkpoint. PR #32 later merged at `c06937572889a5e74c88d4cda555e2df954ebaf2`; PR #34 then advanced master to `de4d9344e5ffd98962df154a54e806b38bea426b`. The historical checkpoint is not rewritten here; current process status is based on the latest Git/GitHub state and is evidenced separately in §15.

## 3. Approved target and resource feasibility

### 3.1 Target boundary

The following are **OWNER-APPROVED REQUIREMENTS**, not measured infrastructure:

- Ubuntu 24.04; 2 vCPU; 4 GB RAM; 250 GB storage.
- PostgreSQL 16 + PostGIS.
- No public PostgreSQL endpoint.
- RPO ≤24 hours; RTO ≤4 hours.

docker-compose.production.yml publishes only Nginx edge ports. PostgreSQL uses internal db-private, is pinned to a PostGIS 16/3.5 image digest and has no host ports. The migration profile is one-shot; HTTP startup checks the ledger but does not migrate. See backend/src/index.ts, backend/src/db/migrate.ts and docs/deployment/production-foundation.md.

**Not determined from repository:** actual VM, Docker data root, filesystem/encryption, free disk, live DB bytes/row-size/growth, WAL rate, workload peak, connection saturation, provider throughput/latency/quota or replacement-host time. Target dimensions do not prove capacity.

### 3.2 Resource assessment

| Workload | Target pressure | Required evidence |
|---|---|---|
| Application + database | App, edge and PostgreSQL share 2 vCPU/4 GB. Import load, DB buffers and maintenance compete for CPU/memory. Hosted CI is not target-class evidence. | Representative app+DB workload: CPU/RSS high-water, connections, latency/errors, memory and free-space margin. |
| Snapshot/pg_dump | One PG16 custom dump, no parallel jobs; exported snapshot and migration lock remain through dump. | DB bytes, dump duration/bytes, CPU/RSS, vacuum/WAL effects, application/import latency. Set required snapshot maximum only after measurement with safe margin below six-hour cadence. |
| Encryption/upload | age CPU/TLS/upload compete with app/DB; one pipeline only; bounded stream buffers; no plaintext archive staging. | Ciphertext bytes, CPU/RSS, duration, throughput/retries, temp/buffer high-water, egress and provider quota. |
| Backup disk | PGDATA + WAL + Docker images/logs + OS reserve. Streaming avoids a full plaintext dump file; provider adapter must not add unbounded ciphertext spool. | Measure PGDATA/WAL/image/log high-water and any adapter spool; any spool needs a cap and cleanup tests. |
| Restore | Fresh PGDATA needs restored database, indexes, WAL and restore/temp overhead. Same-host isolated restore may require source DB + new target + WAL/temp, not just one archive. | Representative target-class restore; measure bytes, time, CPU/RSS, free disk, WAL/temp and service-recoverable time. |
| 30-day object window | Existing proposal is 30 calendar days/about 120 scheduled generations before failed runs/version history; it is not approved lifecycle behavior. | Artifact size distribution and retained bytes including versions, multipart remnants and holds; owner approves cost/lifetime. |
| Retention/monitoring | Bounded daily cleanup/status checks, but row counts and contention are unknown. | Query duration, backlog/chunk behavior, lock waits, resources and alert freshness on representative data. |

Capacity acceptance requires actual measurements on the approved target class or an explicitly justified equivalent. Record tool versions, UTC times, workload/data class, DB/archive size, CPU/RSS, connection count, WAL/temp/free-disk high-water, upload throughput, app impact and free-space reserve. If capacity fails, stop and return for sizing; do not infer sufficiency from 250 GB or small CI fixtures.

**RPO is measured:** loss-event UTC minus snapshot time of the newest valid verified backup preceding it. Schedule interval alone is not evidence. **RTO is measured:** incident declaration/authorization to service-recoverable state, including host, secrets, restore, validation, application, DNS/TLS/network and traffic switch. pg_restore completion is not the endpoint.

## 4. Phase B — real off-host storage integration

### 4.1 Capability comparison (no provider chosen)

| Approach | Fit and risks | Status |
|---|---|---|
| Independent managed object storage with immutable generations | Can fit exact-key archive/manifest and lifecycle contract. Must verify conditional create, immutable/version behavior, checksum, multipart abort/expiry, least-privilege IAM, failure domain, restore bandwidth, region, legal/data-residency terms and cost. | Preferred capability class, conditional proposal only. No vendor/account/region approved. |
| Separately operated off-host SFTP/object host | Could be independent where an existing service is operated; requires equivalent create-only identity, checksum/version evidence, retention/cleanup, audit, availability and restore bandwidth; SSH host-key/credential operations add scope. | Accept only if all capabilities are evidenced; not preferred without an existing owner-operated service. |
| Same VM, same PG volume or mutable local directory as only copy | Simple but cannot recover from host/disk loss and is not off-host. | Rejected as sole production copy; local fake stays test-only. |

The narrow adapter already exists in backend/src/backup/storage.ts: create immutable object, finalize, verify exact identity, create-only manifest, abort incomplete upload. It intentionally has no arbitrary listing/read/delete/lifecycle/account-admin API.

### 4.2 Artifact contract

Preserve the [Phase B contract](database-operations-phase-b-backup-plan.md) and [implementation](database-operations-phase-b-implementation.md):

1. New random run ID and unique archive/manifest keys per attempt; never overwrite a generation on retry.
2. Backup-only lock, then canonical migration/schema lock (namespace 1701669235, key 3). If migration lock is unavailable, release backup lock and make zero snapshot, dump or storage calls.
3. In read-only repeatable-read exporter transaction capture UTC snapshot timestamp, PostgreSQL/PostGIS versions and ordered migration ledger. Keep exported snapshot/migration barrier until PG16 pg_dump --snapshot finishes consuming it.
4. PG16 custom dump, no owner/privileges, no parallel jobs; stream through age. No plaintext dump on persistent disk, logs, object storage or unbounded spool.
5. Upload ciphertext to unique immutable key. Verify exact object key/version, bytes and a documented provider checksum or separately approved integrity method. Do not treat undocumented ETag or echoed metadata as independent proof.
6. Publish secret-free versioned manifest last, binding exact run/object identity, source snapshot/ledger, build/tool versions, recipient key ID, ciphertext size/hash and remote result. Verify exact manifest identity.
7. Failure, timeout, provider outage, nonzero child, ambiguous finalize or mismatch means no complete manifest/result. Clean temp credentials; abort multipart where supported. Orphan object is not a recovery generation. Cleanup uses a separate approved lifecycle identity.
8. Retry only through Phase C policy; new run ID each time. Keep last verified generation during outage; no plaintext or local-only fallback.

### 4.3 Network/process boundary

Use the approved one-shot Compose approach in Phase B backup plan §4.2: dedicated backup-only container, not HTTP backend; connect to PostgreSQL over db-private and selected storage over separately controlled backup egress. PostgreSQL itself stays off provider egress. Do not publish a DB host port or pass Docker socket into a container.

Host systemd invokes one fixed, root-owned wrapper for the one-shot Compose service/profile. Docker daemon control is effectively root-level; wrapper ownership, arguments, compose project/files, environment, secrets and audit need infrastructure review. Current templates invoke an installed Node script directly and current CLI rejects production; the template alone does not prove private Compose network connectivity. Align production unit/wrapper with the production adapter before activation.

Writer: create archive/manifest and inspect exact object metadata only. Restore principal: read-only backup prefix. Lifecycle principal: separately approved cleanup. No routine principal decrypts, lists unrelated objects, deletes generations or administers the account.

### 4.4 Failure and retry acceptance

Test conditional-create collision, exact version identity, checksum/size mismatch, absent checksum, multipart abort, partial upload, ambiguous finalize, manifest collision, provider 429/5xx/timeout, retry with a new ID, no late manifest after abort, and zero storage calls before storage admission. Use fake transports in CI and an isolated provider sandbox only after infrastructure supplies one.

## 5. Key custody and recovery access

**Current:** offline writer needs public age recipient; synthetic private identity is used only by isolated verifier tests. Writer config rejects private identity variables. Evidence: backend/src/backup/config.ts, runner.ts, manifest.ts and Phase B checkpoint.

**Production contract:**

- Owner names accountable key custodian and authorized recovery operator(s). Two-person break-glass is a recommendation pending owner/security decision.
- Private identity is held outside production VM and routine writer credentials with an independent loss/recovery route. Never commit it, put in normal app env, argv or stdout/stderr/logs.
- Writer gets public recipient only. Restore verifier receives private identity only during approved controlled restore; object-read permission and key custody should be separate where practical.
- Runbook names restore request/approval, identity verification, emergency retrieval after VM loss, access audit, post-use cleanup/revocation and incident escalation.
- Before activation recover key via the independent route and decrypt an exact selected object on isolated target. Synthetic CI key success is not custody evidence.
- Rotation preserves decryption for all unexpired generations. Publish future runs under new IDs while retaining old access through expiry or controlled re-encryption. No silent old-key retirement.
- Add no complex rotation/escrow system unless accepted risk model requires it.

**OWNER DECISION REQUIRED:** custodian, recovery authority, mechanism, break-glass approval, escrow/two-person policy and old-key retention. Until then key custody and production backup activation are blocked.

## 6. Phase C — production scheduling and host contract

### 6.1 Preserve current behavior

backend/src/operations/scheduler.ts implements:

- UTC slots 00/06/12/18.
- Persistent minute-level reconciliation; missed runs coalesce to latest due slot; no stale slot replay.
- Separate scheduler lock and backup-only lock.
- One retry after 15 minutes, max two attempts per slot, no infinite loop.
- Journal is authoritative for attempt/retry state, not systemd restart counters.
- Crash reconciliation does not fabricate a complete artifact.
- SIGTERM/SIGINT aborts active operation and requires bounded child cleanup, transaction/lock release, storage cancellation and process completion.

Current backup timer is a persistent one-minute poll. Retention and monitoring timers are daily reference templates. All templates are uninstalled/unenabled with no Install section. Evidence: database/operations/systemd/public-lighting-*.in.

### 6.2 Host installation/privilege contract

A host package/unit must pin exact release/build SHA and immutable/root-owned installation; fixed compose files/project/profile/service; no caller-controlled shell/compose args; dedicated service identity/group; restricted Docker access model (root-equivalent); protected file-backed credentials; public recipient only; build identity and measured snapshot max; private operations state (proposed /var/lib/public-lighting/operations, mode 0700); bounded secret-free logs; and systemd sandboxing with only required writable paths.

Reconcile current template mismatch before activation: templates set NODE_ENV=production while current CLI returns production_operations_adapter_not_configured. Host process connectivity to private db-private is also not established by a template. Production wiring needs the production adapter and fixed Compose invocation while all unresolved gates remain fail-closed.

### 6.3 Host validation not proven by CI

On target host demonstrate unit/timer syntax, service user/group, ownership/modes, symlink protections, installation provenance, first boot/reboot/missed-slot behavior, UTC/clock handling, concurrent triggers, restart, SIGTERM/child cleanup, lock release, and journal durability. Test Docker daemon/Compose/DB unhealthy, absent credential, disk low, egress blocked, storage outage, and kills at each publication boundary; verify no fallback or false success. Prove one-shot can use private DB network without a published port and only selected storage egress. Define log bound and operator response when journal reaches 16 MiB. Units remain disabled pending final approval.

CI has Linux synthetic signal and process-egress checks; it does not prove actual owner-host systemd, Docker permissions, egress policy, power-loss durability or restarts.

## 7. Phases D/E — restore runbook and evidence

### 7.1 Operator sequence

1. Declare incident/drill; record incident authorization UTC, suspected data-loss UTC, operator/approver and whether writes stop. Preserve source VM/volume.
2. Select newest known-good verified generation preceding event. Record exact manifest/object/version/hash/bytes/snapshot/key ID/build/migration ledger.
3. Read exact object with recovery-only identity; verify provider version/checksum/size and manifest; retrieve private identity via approved custody.
4. Provision isolated fresh PG16/PostGIS target. Full VM loss includes Ubuntu, Docker/Compose, firewall, TLS/DNS/proxy, app build and secrets.
5. Provision roles/extensions using controlled DBA procedure and fail-on-collision assertions. Restore into fresh database with pg_restore --no-owner --no-acl --exit-on-error; never --clean an existing production DB. Apply canonical grants.
6. ANALYZE; validate PostGIS, constraints, sequences, migration ledger vs exact app package and representative runtime paths. Never auto-migrate during restore. Start import worker only after roles/ledger pass.
7. Start app/edge in isolated/maintenance mode; verify health, origins/API and representative admin/inventory/import/export/audit paths; obtain operator approval, then switch traffic.
8. Preserve source through approved forensic/rollback window. On failed gate do not route traffic; diagnose before using another generation. Retention is separate, after recovery; no ad hoc DELETE.

Evidence sources: database/production, backend/src/db/migrate.ts, migrationPreflight.ts, productionFoundation.postgres.test.ts and the [existing recovery plan](database-operations-recovery-retention-plan.md). Actual DNS/TLS/replacement-host process is not in repo.

### 7.2 Evidence classes

| Exercise | Proves | Does not prove |
|---|---|---|
| A. Isolated restore verification | One exact object/key/checksum decrypts and restores on isolated disposable target. | Target capacity, production RPO/RTO or VM-loss procedure. |
| B. Target-class recovery drill | Full recovery on approved/equivalent target measures resources and RPO/RTO for exercised path. | Full VM-loss unless host/config/DNS/TLS/secret path is included. |
| C. Complete VM-loss recovery | Replacement host, credentials/key, restore, service validation and traffic switch. | Untested alternative region/provider/failure modes. |

Synthetic CI is not class B/C evidence.

### 7.3 RPO/RTO evidence contract

Keep secret-free drill ID/class, authorization, operator/approver, environment and tool versions; incident/declaration/data-loss UTC separately; exact artifact identity and key ID; UTC retrieval/decrypt/restore/validation/app/traffic/service-recoverable timestamps; CPU/RSS/DB/archive/WAL/temp/disk/connections/network; per-check result, failures/retries/root cause; measured RPO = loss event UTC minus snapshot UTC; measured RTO = service-recoverable UTC minus incident declaration; final PASS/FAIL.

RPO ≤24h and RTO ≤4h are requirements, not achieved results. Exactly 24h RPO is within the limit with no margin. A successful target-class drill is mandatory before production activation. Existing parent plan proposes quarterly drills; owner must confirm cadence. Failed evidence remains failed; never replace runtime timing with CI duration.

## 8. Phase F — retention safety

### 8.1 Existing safe scope

Offline core deletes only admin_activity_logs, inventory_audit_events and expired admin_refresh_sessions. It uses one UTC run time/calendar-year cutoff, strict less-than, separate lock, 500-row chunks/max 100 per table, per-chunk transactions/timeouts and backlog reporting. Earlier successful chunks remain committed if a later chunk fails; retry must be idempotent. Production mode still rejects.

Import batches are measured/deferred; they are not deleted because maximum child cascade cardinality is not proven. integration_logs remains owner-unclassified and is not deleted. light_points, admins and schema_migrations are outside retention allowlist. One-year DB row policy and proposed 30-day backup-object window are separate.

### 8.2 Activation conditions

Before enabling deletion: owner/legal confirm category/cutoff; classify integration_logs; prove maximum import child cardinality or keep imports excluded; use read-only eligibility/dry run; verify least-privileged lighting_retention and denial of TRUNCATE/DDL/UPDATE/master deletes; test cutoff/leap-day/timezone/FK/cascade/chunk rollback/retry/overlap/termination/backlog in disposable PG16; prove restore interaction; define disable/rollback and last successful cutoff. No “delete all expired” override.

### 8.3 Backup expiry/legal hold

30 calendar days/about 120 generations is a proposal, not approved destructive policy. Decide object expiry, noncurrent versions, legal hold, orphan/multipart grace, deletion evidence and erasure interaction. Until decision/provider evidence, no real object expiry/deletion. Restoring older valid snapshot may reintroduce live rows already past retention; recover service first and then run separately approved retention.

## 9. Phase G — monitoring and alerting

### 9.1 Inputs and collection gaps

monitoring.ts evaluates a supplied bounded snapshot; databaseOperations.ts reads synthetic JSON only. Production collectors are absent. Future inputs need authoritative exact manifest/object integrity and recovery-verified snapshot; final scheduled/integrity failures; DB availability/migration status; retention success/failure/backlog; target-class drill evidence class/date; host CPU/RSS/free disk. Keep inputs secret-free; avoid row content, usernames, exact coordinates, tokens, SQL text or secret URLs. Review minimal DB permission for each collector.

### 9.2 Preserve approved rules and connect delivery

- Pre-production missing target-class evidence => severity unknown; recovery readiness UNVERIFIED.
- Before production activation, no successful target-class drill => BLOCKED.
- In activated production monitoring, missing/invalid required drill is critical.
- Drill age >90 days warning; >120 days critical.
- Backup age >18h warning; ≥24h critical; >24h RPO requirement exceeded. Final scheduled failure or integrity failure is immediately critical.
- Producer completion, journal record or synthetic CI never counts as recovery verification.

Implementation must encode activation context so missing drill is unknown pre-production, blocks activation, and is critical after activation. This applies the approved policy, not a new policy decision.

Owner selects receiver, destination, on-call owner, escalation/acknowledgement, retries/backoff, dedup/suppression and evidence retention. Until selected, delivery_status stays not_configured; local journal/stdout is not alert delivery. Tests use fake receiver for stale/malformed/future snapshots, policy context, outage/429/5xx/timeout, bounded retries, duplicate suppression, ack, secret redaction and event-to-receipt binding.

## 10. Open P2/security findings

### 10.1 Carried findings

| Finding | State | Closure scope in next coherent implementation package | Production relevance |
|---|---|---|---|
| Restore lifecycle correction — target-session drain before cleanup | CLOSED offline. PR #34 (`350e19acda25ff5f4f073ba4068deeb4355c6ce5`) is merged as `de4d9344e5ffd98962df154a54e806b38bea426b`; exact post-merge run 37979668773 passed. The PG16 lifecycle trace shows pool shutdown resolved, session drain observed, concurrent session closed, then client socket closed; no unhandled PostgreSQL `57P01` teardown error was found. | No further change in this plan. Host/systemd/provider-backed restore remains untested and blocked by other gates. | Offline lifecycle correction is validated; this does not prove production restore readiness. |
| P2-A — restore session timeout reset failure and shared-pool concurrency evidence | OPEN, non-blocking offline. PR #32 preserves prior statement_timeout/lock_timeout and discards the client if reset cannot be confirmed. The current plan's recorded PG16 coverage does not close the specifically audited reset-failure injection and shared-pool concurrency evidence gap. | Disposable PG16 test deliberately fails restoration of each setting; prove contaminated client discarded, pool usable, no borrower inherits restore limits; deterministic concurrent restore/shared-pool barrier; no leaked clients; bounded cleanup. Keep normal HTTP startup semantics unchanged. | Close before provider-backed restore; distinct from the PR #34 target-session lifecycle correction. |
| P2-B — test-only PostgreSQL pool error listener lifetime | CLOSED in PR #34. The fixture removes its listener in cleanup and asserts that listener count returns to baseline; exact-head and post-merge CI passed. | No further change in this plan. Production logging semantics are unchanged. | Test-harness issue closed by a targeted regression; this is not evidence that all pool/runtime errors are impossible. |
| Admin-query wall-clock timeout | OPEN, non-blocking P2, separate from restore-session timeout restoration and the PR #34 lifecycle correction. The supplied audit status identifies the finding; its precise query/function-level acceptance evidence is not reproduced in this plan. | Preserve as a separate follow-up: identify the audited admin-query path and demonstrate a bounded wall-clock deadline with regression evidence before closing. Do not infer closure from statement_timeout/session cleanup tests. | Does not block this documentation-plan integration; remains a production-hardening follow-up. |
| Phase A — interrupted maintenance-role provisioning | OPEN P2. create-maintenance-roles.psql commits role creation before interactive password prompts. Interruption can leave reserved names; fail-on-collision prevents blind rerun. | Add a least-privileged DBA recovery procedure and disposable failure test: inspect role attributes/memberships/ownership/grants, reset credentials through an approved secure method, rerun assertions/grants, prove no automatic drop/reuse/privilege broadening. If owner wants automated resume, decide/test separately. | Relevant to initial production provisioning; fail-closed collision limits silent privilege expansion but requires DBA action. |

Do not mark P2-A, the admin-query wall-clock timeout or the Phase A provisioning finding closed without their specific evidence. Restore lifecycle correction and P2-B are closed only for the offline scope evidenced above. Do not split separate PRs solely for the remaining findings.

### 10.2 Dependency and SQLFluff baseline

Historical baseline artifacts from PR #32 post-merge run 37959268778 at master `c06937572889a5e74c88d4cda555e2df954ebaf2` were downloaded and inspected; these counts are not represented as newly measured on PR #34's current master:

- Full npm audit: backend 6 findings (2 critical, 1 high, 3 moderate, 0 low); frontend 11 (2 critical, 5 high, 4 moderate, 0 low). Direct Vite/Vitest entries are package devDependencies and report covers development/test tree. Required CI command npm audit --omit=dev --audit-level=moderate passed for frontend/backend; this is not a full-tree clean report and does not rule out low findings or establish reachability/exploitability. The report job is informational. PR #32 changed no dependencies.
- SQLFluff report: 254 violation rows across six failing SQL files: database/schema.sql 52; grant-maintenance-roles.sql 24; create-maintenance-roles.sql 2; create-application-roles.sql 3; migration 0002 122; migration 0001 51. database/seed.sql is 53,148 bytes and skipped at the configured 20,000-byte limit. Green sqlfluff-report means artifact produced/uploaded, not lint passed. PR #32 changed no SQL.

Treat these historical counts as baseline items for separate triage. PR #34's informational dependency-audit-report and sqlfluff-report jobs succeeded, but those report jobs do not establish zero findings; no fresh artifact count is asserted here. No automatic dependency upgrades or SQL fixes are part of this plan.

## 11. Owner/infrastructure decision matrix

Recommendations below are proposals only. Every undecided production default is NOT ACTIVATED / FAIL CLOSED.

| Decision | Options | Recommended option (proposal) | Rationale / impact | Default if undecided | Owner action required |
|---|---|---|---|---|---|
| Off-host provider/account/region | Independent managed object store; existing separately operated SFTP/object host; none. | Capability-qualified independent object-storage failure domain, vendor only after evidence. | Affects adapter, egress, IAM, cost, residency, restore bandwidth. | NOT ACTIVATED; fake only. | Select account/project, region, owner, residency, budget and support. |
| Immutability/version | Create-only keys; versioning; retention lock; mutable overwrite. | Exact create-if-absent + immutable version and documented checksum, mapped to legal/expiry policy. | Binds exact archive and manifest; impacts restore and lifecycle. | No production writes. | Approve exact conditional-create/version/hold/checksum/multipart semantics. |
| Credentials/IAM/egress | Broad shared credential; separate principals; fixed egress/proxy. | Separate least-privileged writer, reader and lifecycle identities; destination-only egress. | Separates creation, recovery and deletion. | No credentials/egress. | Issue scoped identities and demonstrate permissions/network policy. |
| Key custodian/recovery access | Single custodian; two-person break-glass; managed/offline custody. | Owner-defined independent custody; two-person control is only a proposal pending approval. | Determines decryptability after VM loss and audit. | BLOCKED; synthetic keys only. | Name custodian/operators; approve retrieval, audit, break-glass and rotation. |
| Backup generation lifetime | 14/30/60+ days; legal hold; no expiry. | Existing 30-day proposal only if measurements/legal decision support it. | Cost and restore-history window. | No real expiry/delete. | Approve age, versions, orphan cleanup, hold and erasure policy. |
| Monitoring receiver | Existing on-call system; managed receiver; local journal. | Reuse owner-operated receiver if authenticated, acknowledged and deduplicated. | Determines delivery, egress and incident response. | not_configured. | Select receiver, test endpoint and credential owner. |
| Escalation/on-call | Named primary/secondary; rota; none. | Named primary/backup with severity-specific acknowledgement contract. | Determines who acts on critical failure. | BLOCKED. | Assign accountable owner, coverage, escalation and incident authority. |
| integration_logs category | Include one-year; exclude; separate field-level policy. | Exclude until data owner/legal classifies generic JSONB/error content. | Destructive retention/privacy impact. | DO NOT DELETE. | Approve fields/purpose/access and cutoff. |
| Import-history deletion prerequisite | No deletion; measure cascade then bounded parent delete; separate atomic strategy. | No deletion until max child cardinality and FK/audit semantics are proven. | Affects safety and one-year policy execution. | DO NOT DELETE IMPORTS. | Approve bounded/atomic contract and representative evidence. |
| Backup expiry/legal hold | Expire by lifecycle; hold override; indefinite. | Lifecycle with explicit hold and auditable deletion after policy approval. | Encrypted copies may outlive live-row deletion. | NO DELETE/EXPIRY. | Owner/legal approves versions, hold, orphan/multipart cleanup and erasure. |
| Target host/storage | Approved 2vCPU/4GB/250GB; resize/separate restore host. | Measure approved class first; resize/isolate if it fails. | Controls cadence, restore, RPO/RTO and cost. | No host/timer/restore activation. | Provide isolated target, disk/network layout and rebuild SLA; approve resize. |
| Snapshot maximum | Required measured max; absent/fail closed. | Set only after target measurement with margin below six-hour cadence. | Controls snapshot/vacuum/workload safety. | Fail before snapshot. | Operations records measured value/approver; owner only if a product trade-off emerges. |
| Recovery drill cadence | Quarterly; other owner schedule; none. | Parent plan proposes quarterly; confirm owner and availability. | Controls evidence freshness. | UNVERIFIED; activation blocked. | Approve cadence, owner and evidence retention. |

### 11.1 Approval authority and execution ownership

This is a role-accountability map, not an assignment of named people or approval of any pending decision. Approval authority decides policy, risk acceptance or activation; execution ownership performs the approved provisioning, configuration, measurement or operation. No named role holders or assignments are established by this repository. Every row remains **TBD / OWNER DECISION REQUIRED** until the owner assigns the functions and records the actual approver and executor.

| Pending decision | Approval authority (functional role) | Execution owner (functional role) | Assignment status |
|---|---|---|---|
| Off-host provider/account/region | Product/service owner; infrastructure and security approvers for deployment constraints | Cloud/platform operations provisions the selected account, region and service | TBD / OWNER DECISION REQUIRED |
| Immutability/version/checksum semantics | Product/data owner and security; legal/privacy review where retention or residency applies | Storage/platform engineer implements and evidences object semantics | TBD / OWNER DECISION REQUIRED |
| Credentials, IAM and egress | Security authority and infrastructure owner | Platform operations configures identities and network policy; DBA validates database boundary | TBD / OWNER DECISION REQUIRED |
| Key custodian and recovery access | Security authority and product/service owner | Assigned key custodian and recovery operator perform custody and drill steps | TBD / OWNER DECISION REQUIRED |
| Backup-generation lifetime | Data owner and legal/privacy authority; product owner accepts service trade-off | Storage lifecycle operator configures only the approved policy | TBD / OWNER DECISION REQUIRED |
| Monitoring receiver | Service owner and security authority | Monitoring/platform owner integrates the receiver and evidence path | TBD / OWNER DECISION REQUIRED |
| Escalation and on-call | Service owner / operations lead | On-call lead assigns coverage and executes escalation procedures | TBD / OWNER DECISION REQUIRED |
| `integration_logs` classification | Data owner and legal/privacy authority | DBA/data-platform operator implements only an approved classification and retention rule | TBD / OWNER DECISION REQUIRED |
| Import-history deletion | Product/data owner and legal/privacy authority; DBA advises on integrity constraints | DBA/data-platform operator measures cascade bounds and implements only the approved rule | TBD / OWNER DECISION REQUIRED |
| Backup expiry and legal hold | Data owner and legal/privacy authority; product owner approves recovery-window impact | Storage lifecycle operator configures approved expiry/hold behavior and deletion evidence | TBD / OWNER DECISION REQUIRED |
| Target host and storage capacity | Product/service owner approves target requirement; infrastructure/security owner approves host controls | Platform operations and DBA provision and measure the isolated target | TBD / OWNER DECISION REQUIRED |
| Snapshot maximum | Product/service owner accepts workload impact; DBA approves the technical measurement method | DBA and platform engineer measure and record the safe maximum | TBD / OWNER DECISION REQUIRED |
| Recovery-drill cadence | Product/service owner and operations lead | Recovery operator/on-call team schedules, executes and retains drill evidence | TBD / OWNER DECISION REQUIRED |

Role names above identify the functions that must participate; they do not assert that those roles exist, are staffed, or have accepted responsibility. Approval and execution ownership must be recorded separately before the related production gate can close.

## 12. One coherent implementation roadmap

This is one dependency-aware implementation package after prerequisite decisions, not seven phase PRs. Keep activation switches disabled until evidence passes.

### Gates before production integration work

1. Close provider/account/region and exact object semantics; credentials/IAM/egress; private-key custody; backup expiry/legal hold; receiver/on-call; retention classification/import bound; target resources and drill cadence.
2. Provide safe provider sandbox and target-class environment. Code-level adapter tests need no production credential.
3. Agree secret-free evidence contract and operator ownership for target-class drill.

Offline/fake work can proceed before provider selection. No provider adapter, credential, destructive job, timer enablement or production mode until its gate closes.

### Single implementation package after gates

1. Close the open P2-A restore timeout-reset/shared-pool evidence, the separate admin-query wall-clock timeout P2, and the Phase A provisioning-interruption P2 with targeted evidence (§10). PR #34 lifecycle correction and P2-B are already closed for the offline scope.
2. Implement selected provider adapter behind existing BackupStorageAdapter; add dedicated backup Compose service/profile on private DB plus constrained storage egress; never give Postgres provider egress or publish DB port.
3. Add production secret loading, immutable release install/provenance, fixed root-owned host wrapper and systemd package. Keep offline fake path distinct; shipped timers default disabled.
4. Add production read-only restore adapter and exact artifact verifier; preserve fresh-target, key, timeout and cleanup guarantees.
5. Add collectors/receiver with explicit pre-production/activation/active monitoring context and fake-receiver tests.
6. Enable only the three already-approved retention deletes after dry-run, grant, cutoff, rollback and owner/legal review. Import deletion and integration_logs remain disabled until their prerequisite decision closes.
7. Run disposable PG16/PostGIS, adapter failure contract, typecheck/build, process-egress/browser CI and target-class capacity/restore acceptance. Report npm/SQLFluff baseline separately.
8. Independent implementation audit and owner activation review precede enabling timer, provider egress, destructive retention, external alerts or production restore.

### Work safe before decisions

Documentation; fake adapter contracts; deterministic failure injection for remaining P2 findings and Phase A recovery/runbook; synthetic resource measurement harness; evaluator/collector/receiver tests against fakes; unit syntax validation without installation or enablement.

### Work gated

Provider-specific adapter/credentials, real private-key access, host timer, production restore, destructive retention/backup expiry, external alerts, and any RPO/RTO compliance claim.

## 13. Production-readiness acceptance matrix

No capability is READY today.

| Verdict | Current state and exact evidence | Missing code/tests/evidence | Activation status |
|---|---|---|---|
| BACKUP STORAGE READY | Fake adapter only; config rejects production. storage.ts/config.ts/localFakeStorage.ts; historical PR #32 run 37959268778 succeeded. | Provider adapter, scoped credentials, exact version/checksum/collision/outage tests, account/region/legal/egress evidence. | **NOT READY / BLOCKED**. |
| BACKUP SCHEDULING READY | Algorithm/journal implemented; templates reference-only. scheduler.ts/fileSchedulerJournal.ts/operations.test.ts. | Production adapter/wrapper/install, systemd host/reboot/permission/signal tests, measured snapshot maximum and host evidence. | **NOT READY**. |
| RESTORE READY | Fresh loopback restore with fake reader; 37 PG16 foundation tests passed in PR #34 post-merge CI; target-session drain lifecycle correction CLOSED. | Real read adapter/key route, remaining P2-A reset/concurrency evidence, separate admin-query wall-clock timeout evidence, runbook and target host capacity/evidence. | **NOT READY**. |
| TARGET-CLASS RECOVERY VERIFIED | Synthetic drill only. | Successful target-class recovery; complete VM-loss if that path is claimed; actual RPO/RTO evidence. | **NOT VERIFIED**. |
| RETENTION READY | Bounded offline algorithm, three-table allowlist, production rejects. | Production service/identity; dry-run, grants and rollback; integration_logs and import decisions. | **NOT READY; NO DESTRUCTIVE JOBS**. |
| MONITORING READY | Pure evaluator; no collector/receiver; delivery not configured. | Authoritative inputs, activation-context policy, receiver/on-call, delivery tests and host metrics. | **NOT READY**. |
| FULL PRODUCTION OPERATIONS READY | Offline A–G integrated; no production operation. | All owner/infra gates, target measurements, operational package, successful target-class recovery and activation approval. | **NOT READY / NOT APPROVED**. |

## 14. Explicit blockers and scope boundaries

### Production blockers

- No provider/account/region, exact object semantics, scoped credentials or approved egress.
- No private-key custodian/recovery route or real exact-object decrypt evidence.
- Commands intentionally reject production; systemd templates are disabled references and do not provide working production adapter/network path.
- No representative target-class backup/restore/resource measurements.
- No successful target-class recovery drill; RPO/RTO remain requirements, not results.
- No production collectors, receiver or on-call contract.
- No timer, row-retention or backup-expiry approval.
- integration_logs and import-deletion gates unresolved.
- P2-A restore timeout-reset/shared-pool evidence remains open; the separate admin-query wall-clock timeout remains an open non-blocking P2; Phase A provisioning-interruption P2 remains open. Restore lifecycle correction and P2-B are closed for offline scope only.

### Non-blocking baseline

Full npm audit and SQLFluff findings are recorded in §10.2; informational green jobs do not mean zero findings. Journal rotation is not implemented. Fake storage is not provider evidence. Prior C–G checkpoint contains stale PR status wording; actual merge/CI is cited in this plan.

No production database/storage, provider account, key, credentials, host, AUSEMIO or live provider was accessed. This plan changes no product/data decision and authorizes no implementation or activation.

## 15. References and evidence

### Canonical documents
- [Database Operations, Recovery, and Retention Plan](database-operations-recovery-retention-plan.md)
- [Phase B backup plan](database-operations-phase-b-backup-plan.md)
- [Phase B implementation checkpoint](database-operations-phase-b-implementation.md)
- [Phases C–G implementation checkpoint](database-operations-phases-c-g-implementation.md)
- [Production foundation](../../deployment/production-foundation.md)
- [CI workflow](../../../.github/workflows/ci.yml)

### Code and tests
- [Production Compose](../../../docker-compose.production.yml)
- [Backup runner](../../../backend/src/backup/runner.ts), [config](../../../backend/src/backup/config.ts), [manifest](../../../backend/src/backup/manifest.ts), [storage boundary](../../../backend/src/backup/storage.ts), [fake adapter](../../../backend/src/backup/localFakeStorage.ts)
- [Scheduler](../../../backend/src/operations/scheduler.ts), [journal](../../../backend/src/operations/fileSchedulerJournal.ts), [evidence writer](../../../backend/src/operations/fileEvidence.ts), [systemd templates](../../../database/operations/systemd/)
- [Controlled restore](../../../backend/src/operations/controlledRestore.ts), [synthetic drill](../../../backend/src/operations/recoveryDrill.ts)
- [Retention](../../../backend/src/operations/retention.ts), [monitoring](../../../backend/src/operations/monitoring.ts), [operations CLI](../../../backend/src/scripts/databaseOperations.ts)
- [Migration runner](../../../backend/src/db/migrate.ts), [preflight](../../../backend/src/db/migrationPreflight.ts), [migrations](../../../backend/src/db/migrations/)
- [Maintenance-role provisioning](../../../database/production/create-maintenance-roles.psql), [maintenance grants](../../../database/production/grant-maintenance-roles.sql), [PG16 integration tests](../../../backend/tests/integration/productionFoundation.postgres.test.ts), [operations tests](../../../backend/tests/unit/operations.test.ts), [backup-core tests](../../../backend/tests/unit/backupCore.test.ts)

### Merge and CI

**Historical PR #32 evidence — not the current master validation:** PR #32 merged at `2026-10-09T16:27:35Z` as `c06937572889a5e74c88d4cda555e2df954ebaf2`. Parents: `22cf5cff3f8714c6c4ef0a3a8edb8576fa41b715` and audited head `bb73885b97d69dd06d838d1f80324ce2d07ed01f`; its merge tree equaled its audited tree.

Historical PR #32 exact post-merge [CI run 37959268778](https://github.com/krustallik/public-lighting-fault-reporting/actions/runs/37959268778), attempt 1, passed all six jobs. Backend: PG16/PostGIS migration/runtime smoke passed; 29 test files, 289 passed, 1 skipped; `productionFoundation.postgres.test.ts` 37 passed; `backupCore.test.ts` 10 passed. Its dependency report and SQLFluff artifact were inspected and are summarized in §10.2. Linux suite included the parent-to-child OS SIGTERM test; host systemd activation remained untested.

**PR #34 exact-head evidence:** audited head `350e19acda25ff5f4f073ba4068deeb4355c6ce5`; exact-head [CI run 37969095528](https://github.com/krustallik/public-lighting-fault-reporting/actions/runs/37969095528), attempt 1, passed all six jobs.

**Current master / PR #34 post-merge evidence:** PR #34 merged at `2026-10-09T19:21:24Z` as `de4d9344e5ffd98962df154a54e806b38bea426b`. Parents are `c06937572889a5e74c88d4cda555e2df954ebaf2` and audited head `350e19acda25ff5f4f073ba4068deeb4355c6ce5`. Merge tree `eb1524735e72a320ca134632eb9f4ec3d4013e92` equals the audited PR #34 tree. Exact post-merge [CI run 37979668773](https://github.com/krustallik/public-lighting-fault-reporting/actions/runs/37979668773), attempt 1, ran on that merge SHA; backend, frontend, process-egress-research, browser-e2e, dependency-audit-report and sqlfluff-report all succeeded.

Backend evidence from run 37979668773: PostgreSQL 16/PostGIS container, canonical migrations and runtime smoke succeeded; `productionFoundation.postgres.test.ts` passed 37 tests; the full backend suite reported 29 files passed, 289 passed, 1 skipped. The restore lifecycle trace ordered pool shutdown resolution → session drain observation → concurrent session closure → client socket closure. The backend log contained no unhandled PostgreSQL `57P01` teardown error. This closes the offline restore lifecycle correction. The targeted test-fixture cleanup also closes P2-B. Neither result proves host/systemd or provider-backed production restore readiness.

The current `dependency-audit-report` and `sqlfluff-report` jobs succeeded as report-producing jobs; green status does not mean zero findings. Historical PR #32 counts in §10.2 remain explicitly tied to that earlier run; no new current-master artifact counts are asserted.

**Checkpoint result:** the plan's previous independent audit was **PASS WITH P2**; the documentation-accountability clarification is closed by §11.1. Production backup, restore, retention, monitoring, scheduling and full operations remain **NOT READY / NOT APPROVED**. Owner/infrastructure decisions and the open findings in §10 remain unresolved.
