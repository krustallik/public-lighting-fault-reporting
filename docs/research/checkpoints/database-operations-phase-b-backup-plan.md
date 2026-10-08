# Database Operations Phase B — Backup Artifact, Encryption, and Storage Plan

**Status:** planning/research only; ready for independent plan audit. Phase B implementation, production backup execution, external storage use, and provider/key activation are not authorized by this document.
**Repository baseline inspected:** `master` at `a30a6982c9e9e6f4a7d4e460045b3043b5659cae`.
**Canonical parent plan:** [Database Operations, Recovery, and Retention Plan](database-operations-recovery-retention-plan.md).
**Scope:** design the one-shot backup artifact path only. No production database or external provider was accessed; no AUSEMIO or application provider was contacted.

This plan uses the status labels defined in the canonical parent plan: **FACT** means verified in the repository or official cited documentation; **OWNER REQUIREMENT** is an already accepted requirement; **PROPOSAL** is an engineering design, not existing behavior or production approval; **DECISION REQUIRED** identifies an owner/infrastructure choice; **EVIDENCE REQUIRED** identifies a technical validation that is still absent.

## 1. Executive summary and Phase B boundary

**PROPOSAL:** Phase B should implement and validate one controlled command that produces a complete logical backup generation along this path:

```text
PostgreSQL consistent snapshot
  → PG16 custom-format logical archive
  → streaming client-side encryption
  → off-host immutable object
  → exact-object integrity/metadata evidence
  → immutable manifest published last
```

The archive should stream from `pg_dump` through a reviewed recipient-encryption process and into a narrowly scoped storage adapter. Plaintext archive bytes must not be written to persistent host storage. The routine writer may use the public encryption recipient and the `lighting_backup` and storage-writer credentials, but must never have the private decryption identity. A manifest object is the producer-side commit marker; it does not mean that a restore drill has passed. A separately controlled verifier must bind one manifest to one exact encrypted object, verify/decrypt it, and inspect the archive before a future release gate relies on it.

Phase B does **not** implement the systemd schedule/retry policy (Phase C), restore execution (Phase D), target-host RPO/RTO drill (Phase E), destructive retention (Phase F), or monitoring integration (Phase G). It exposes a stable one-shot command, statuses, immutable artifact identifiers, and secret-free evidence for those later phases. It makes no production sufficiency claim for the approved VM target.

## 2. Current repository facts

These are code/configuration facts at the baseline, not observations of a live host, database, storage account, or production data.

| Area | Verified fact and source |
|---|---|
| Production database | [`docker-compose.production.yml`](../../../docker-compose.production.yml) pins `postgis/postgis:16-3.5` by digest and stores PGDATA in named volume `production_pgdata`. The database is on `db-private`, with no host-published database port. |
| Application networks | The production API joins `db-private`, `api-private`, and `provider-egress`; Postgres, migrations, and bootstrap join only `db-private`. No backup service, backup profile, or backup-specific egress policy is present. A Docker network declaration by itself is not proof of a host egress allowlist. |
| File-backed secret model | Production Compose uses Compose file-backed secrets for DB/application credentials. There is currently no `lighting_backup` secret mount or consumer in Compose; do not infer one from the SQL role. The backend only receives the runtime DB credential. |
| Backup DB role | [`database/production/grant-maintenance-roles.sql`](../../../database/production/grant-maintenance-roles.sql) grants `lighting_backup` `CONNECT`, `USAGE` on `public`, `SELECT` on the nine explicitly listed application/ledger tables, and `SELECT` on seven current sequences. It does not grant table writes, DDL, database/schema creation, memberships, or default privileges. Reapplication revokes stale direct table/sequence/column grants before restating the allowlist. |
| Grant behavior on schema growth | The grant file is an explicit current-object allowlist without `ALTER DEFAULT PRIVILEGES`. A newly added table/sequence is not silently granted to `lighting_backup`; the role is expected to fail visibly until a DBA reviews and reapplies an updated allowlist. The disposable PostgreSQL integration test checks this boundary. |
| Migration workflow | [`backend/src/db/migrate.ts`](../../../backend/src/db/migrate.ts) owns `schema_migrations`, checksum validation, `runMigrations`, and the pre-start `assertMigrationsCurrent` check. Migrations are explicit; production HTTP startup does not apply them. Current SQL files are [`0001_initial_schema.sql`](../../../backend/src/db/migrations/0001_initial_schema.sql) and [`0002_p3_postgis_inventory.sql`](../../../backend/src/db/migrations/0002_p3_postgis_inventory.sql). There are no checked-in down migrations. |
| PG client/CI | [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml) installs PostgreSQL 16 client tools, asserts `pg_dump` major version 16, and runs disposable PostgreSQL/PostGIS jobs. [`productionFoundation.postgres.test.ts`](../../../backend/tests/integration/productionFoundation.postgres.test.ts) exercises `pg_dump --format=custom --no-owner --no-privileges` as `lighting_backup`, then runs `pg_restore --list` and checks representative table/sequence entries. The test uses a temporary plaintext archive in disposable CI; that is evidence about the test, not an approved production staging design. |
| Backup implementation inventory | No backup runner, schedule/timer, upload client, encryption tool/dependency, backup manifest implementation, restore command, or production backup monitoring state was found in tracked repository files. The current production deployment notes in [`production-foundation.md`](../../deployment/production-foundation.md) likewise say these operations are not implemented. |
| Phase A status | **OWNER-PROVIDED / APPROVED PROCESS STATE:** Phase A is CLOSED. Its role and privilege work is present in repository evidence above. The Phase A interruption P2 is carried in §18 below. |

**Not determined from the repository:** whether any live database exists; its server/extension versions, size, growth, WAL rate, row distribution, import concurrency, host resources, free disk, storage account, backups, credentials, keys, or operational history. No runtime database or host inspection was performed.

## 3. Existing requirements and decisions

### 3.1 Requirements retained from the approved parent plan

- **OWNER REQUIREMENT:** PostgreSQL 16 with PostGIS; target class Ubuntu 24.04, 2 vCPU, 4 GB RAM, 250 GB disk; private DB; existing application-role separation; RPO ≤ 24 hours; RTO ≤ 4 hours.
- **OWNER REQUIREMENT:** the approved parent plan proposes a complete logical `pg_dump -Fc` generation every six hours as the operational direction. The schedule itself belongs to Phase C; this plan does not implement it.
- **OWNER REQUIREMENT / EXISTING SCOPE:** AUSEMIO remains on hold; product scope remains service `2` / VO only; service `16` / CSS remains out of scope; inventory automatic geocoding remains off. None is changed by database backup work.

### 3.2 Explicit unresolved gates

- **DECISION REQUIRED — OFF-HOST STORAGE PROVIDER / ACCOUNT / REGION:** no specific storage provider, account, region, endpoint, lifecycle/versioning policy, or credentials are selected by repository evidence.
- **DECISION REQUIRED — ENCRYPTION KEY CUSTODY / RECOVERY:** `ENCRYPTION KEY CUSTODY / RECOVERY = OWNER/INFRASTRUCTURE DECISION REQUIRED`. The organization must decide the custody and recovery authority, private-key location, access process, and emergency path. This plan does not select a secret-management product or people.
- **DECISION REQUIRED — STORAGE CREDENTIAL ISSUANCE:** who issues and rotates a narrowly scoped writer identity and who controls restore-reader/lifecycle credentials is not established in the repo.
- **DECISION REQUIRED — BACKUP-COPY DELETION / LEGAL HOLD:** if applicable, deletion/legal-hold requirements for off-host copies must be settled with the existing retention policy before the separate retention phase is activated. Phase B writer receives no deletion permission.

These gates do not block synthetic CI design/tests or a provider-neutral orchestration prototype. They do block production storage adapter selection, credentials, encrypted production uploads, and activation.

## 4. Proposed Phase B architecture and outputs

### 4.1 One-shot producer

**PROPOSAL:** a small, dedicated one-shot backup process owns the workflow. A single orchestrator supervises a single PostgreSQL exporter session, `pg_dump`, the encryption child, and one storage upload. It exposes a deterministic result/status and never reports a generation as complete until all producer stages and remote integrity verification succeed.

The Phase B output contract is:

1. one immutable encrypted archive object with a unique run ID and exact object identity;
2. one secret-free versioned manifest uploaded only after archive completion and verification;
3. one secret-free structured terminal result with state, run ID, manifest ID if committed, timestamps/durations, byte count, checksums, and a stable exit code;
4. no plaintext archive on persistent storage and no deletion power on the writer.

No new application data table or migration is needed for this boundary. Build SHA and canonical migration-ledger state are read as metadata at run time; the snapshot data remains inside the encrypted archive.

### 4.2 Process placement

**PROPOSAL:** use a dedicated Compose one-shot service/profile rather than a host process. The DB has no host port and is reachable only on `db-private`; exposing a host DB port merely for backup would weaken the existing boundary. The proposed one-shot container joins `db-private` for PostgreSQL and a separately controlled backup-egress path for the selected storage endpoint. Postgres itself must stay off provider egress. Do not reuse the backend container or its broad provider network as the backup identity.

The one-shot service should receive only:

- the `lighting_backup` DB credential as a protected file-backed secret;
- the public encryption recipient/configuration (not secret);
- the narrowly scoped storage-writer credential as a protected file-backed secret;
- build/migration identity and the required snapshot-max configuration;
- an explicitly bounded in-memory/ephemeral working area for non-plaintext metadata only.

It should not receive the Docker socket, DBA/migrator/runtime credentials, private decryption key, lifecycle credential, or application-provider credentials. Use a read-only root filesystem, dropped capabilities, non-root user, and `no-new-privileges` consistently with the production Compose hardening. If the selected upload protocol requires temporary ciphertext spool, that exception must have a measured disk bound and independent review; plaintext spool remains prohibited.

**DECISION/EVIDENCE REQUIRED:** repository Docker networking alone does not establish external egress filtering. The host/infrastructure must provide and demonstrate bounded TLS egress to the selected storage endpoint without granting egress to Postgres. If that cannot be enforced/tested, production activation is blocked.

## 5. PostgreSQL snapshot and dump sequence

### 5.1 Required sequence

**PROPOSAL:** the orchestrator performs this exact order:

1. Validate required configuration, including `BACKUP_MAX_SNAPSHOT_LIFETIME`, before opening a snapshot transaction. Missing, zero, malformed, or otherwise invalid limit fails closed without acquiring a snapshot.
2. Connect to the target database as `lighting_backup` using a file-backed password mechanism (for example a protected `PGPASSFILE` generated in private ephemeral memory). Never put the password in argv, logs, manifest, or a committed environment file.
3. On a single dedicated exporter connection, attempt a namespaced PostgreSQL session advisory lock reserved for the backup one-shot. If already held, exit as `skipped_overlapping` without snapshot acquisition. Use a stable lock namespace/key that is distinct from the migration/import lock values; verify role access to the advisory-lock function in disposable PostgreSQL before implementation. The lock holds until the full one-shot completes, not just until `pg_dump` ends.
4. Set UTC session timezone, then begin `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`. In the transaction, record `transaction_timestamp()` rendered in UTC as a conservative snapshot-start timestamp and obtain `pg_export_snapshot()`.
5. Keep the exporting transaction and DB connection open. Spawn PG16 `pg_dump` as `lighting_backup` with the same database, `--snapshot=<exported-id> --format=custom --no-owner --no-privileges`, no `--file` output path, and no parallel jobs. Pipe its stdout directly to the encryptor. The exporter transaction must remain alive until `pg_dump` exits because PostgreSQL only allows the exported snapshot to be imported while the exporting transaction remains open.
6. Wait for the complete child pipeline and upload finalization. On any failure, timeout, or signal, cancel the upload, stop children, roll back/close the exporter transaction, and close the connection (releasing the session lock). Do not create a success manifest.
7. On successful dump/encryption/upload, verify the exact archive object's provider metadata and checksum/size. Only then publish the manifest using a unique create-if-absent key and verify that exact manifest object.
8. Release the exporter transaction immediately after dump success/failure, but retain the advisory lock until artifact finalization, remote verification, and manifest publication have completed or failed.

PostgreSQL documents that an exported snapshot can be imported only while its exporting transaction remains open; `SET TRANSACTION SNAPSHOT` must occur before the importing transaction's first query and requires a suitable isolation level ([snapshot synchronization](https://www.postgresql.org/docs/16/functions-admin.html#FUNCTIONS-SNAPSHOT-SYNCHRONIZATION), [`SET TRANSACTION`](https://www.postgresql.org/docs/16/sql-set-transaction.html)). `REPEATABLE READ` uses one stable snapshot for the transaction ([transaction isolation](https://www.postgresql.org/docs/16/transaction-iso.html)). The transaction timestamp may precede the exact snapshot instant slightly; treat it as a conservative timestamp, not a precision claim.

### 5.2 Lock and Phase C interaction

The database session advisory lock is the proposed cross-process overlap guard, including if Phase C later launches duplicate one-shots. Lock collision returns a stable `skipped_overlapping` result. A DB connection loss releases the lock; the orchestrator must then terminate a `pg_dump` whose exported snapshot is no longer importable and must not publish a manifest. Phase C owns timer/retry behavior and must not introduce a second incompatible lock. A future implementation test must show lock release on every exit and signal path.

**EVIDENCE REQUIRED:** role-level advisory lock availability and cleanup behavior must be proven under disposable PG16 with the exact `lighting_backup` grants. No schema permission change should be assumed necessary.

### 5.3 Required snapshot maximum (carried P2 resolved in wording)

`BACKUP_MAX_SNAPSHOT_LIFETIME` is a required deployment setting and a hard elapsed-time ceiling measured with a monotonic clock from snapshot acquisition. A missing/invalid value stops before snapshot acquisition. On expiry, cancel the dump/upload, terminate children, close the exporter transaction, release the lock, and leave no manifest.

**PROPOSAL:** engineering derives a safe value from target-class measurements of dump duration, vacuum impact, WAL behavior, CPU/RSS, disk/temp high-water, application/import latency, and a safety margin below the six-hour cadence. Operations records/configures the resulting deployment value. Product-owner approval is required only if measurements expose a real product trade-off (for example, availability versus snapshot duration), not merely because a technical limit must be configured. **No production numeric value is selected here.** Synthetic CI uses intentionally short thresholds to test timeout and cleanup deterministically.

Long-lived snapshots can delay removal of row versions by VACUUM; exact production impact depends on workload and requires measurement ([PostgreSQL routine vacuuming](https://www.postgresql.org/docs/16/routine-vacuuming.html)).

## 6. Archive format and plaintext boundary

**PROPOSAL:** retain the approved PostgreSQL custom archive format (`pg_dump -Fc`) using the PG16 client. PostgreSQL documents custom format as suitable for `pg_restore` and compressed by default; without `--file`, `pg_dump` writes the archive to standard output ([`pg_dump` documentation](https://www.postgresql.org/docs/16/app-pgdump.html)). The archive should be created with `--no-owner --no-privileges`; a future controlled restore uses `pg_restore --no-owner --no-acl` under a separate identity. This avoids replaying source ownership/ACLs but does not itself provision required extensions/roles or replace the canonical restore procedure.

**PROPOSAL:** stream `pg_dump stdout → age stdin → ciphertext digest/byte counter → storage upload stream`. Do not write plaintext archive bytes to a host file, persistent volume, object-store staging location, or logs. `pg_restore --list` cannot inspect ciphertext in the routine writer; the structural archive check is explicitly deferred to the controlled decrypting verifier described in §12. The current disposable CI test's temporary plaintext dump is test-only evidence and is not the production design.

Use no `-j` parallel dump with this streaming custom-format path. Use the pinned PG16 client already verified in CI; reject unsupported server/client major combinations rather than relying on a lossy downgrade. Target PostGIS availability/version must be verified in a future restore environment; `pg_dump` does not bundle server extension binaries.

## 7. Encryption and key boundary

### 7.1 Candidate contract

**PROPOSAL:** use recipient/public-key encryption with `age` as the initial implementation candidate, subject to version pinning and compatibility/security review. No dependency is added in this planning phase. The upstream project documents recipient/public-key encryption, private identity decryption, and stdin/stdout streaming ([age project](https://github.com/FiloSottile/age)); the format is streamable and uses a fresh random file key, so encrypted output should be treated as non-deterministic ([age format specification](https://c2sp.org/age)).

The writer supplies a public recipient and pipes archive bytes through the encryptor. The private identity is available only to a separate controlled verification/restore process. Writer-side success requires the encryption child to exit successfully and the ciphertext stream to finish; nonzero exit, broken pipe, timeout, or missing output is a failed generation. Do not use deterministic ciphertext as an identity or correctness expectation. Bind exact bytes using ciphertext SHA-256 and byte count.

### 7.2 Key ID and rotation

**PROPOSAL:** record a secret-free key ID as `sha256:<digest>` over a documented canonical encoding of each public recipient identifier. Derive the identifier from public recipient material only; do not include private identity bytes. Freeze canonicalization/version in implementation tests so the same key cannot acquire different IDs through whitespace or formatting changes. If the selected encryption mechanism lacks a stable public identifier, define and test an equivalent public-key fingerprint before implementation.

Rotation must preserve decryptability of all retained generations: new backups may include the new recipient, but old private identities must remain recoverable until the associated generations have expired or been deliberately re-encrypted under a controlled verifier. No in-place overwrite or silent retirement of an old recovery identity. The writer never performs decryption or proves recovery-key custody.

### 7.3 Hard gate

`ENCRYPTION KEY CUSTODY / RECOVERY = OWNER/INFRASTRUCTURE DECISION REQUIRED`.

Before production activation, demonstrate independent recovery access outside the production VM, stable key identification, a reviewed rotation/decryptability process, and an actual controlled decryption using the recovery identity. Who holds keys, where they reside, which secret product is used, and emergency access authority remain undecided. Synthetic test keys may be generated for isolated CI only.

## 8. Off-host storage contract and privileges

### 8.1 Provider-neutral capability contract

`OFF-HOST STORAGE PROVIDER / ACCOUNT / REGION = INFRASTRUCTURE DECISION REQUIRED`.

The selected service must provide, and evidence must confirm:

- a failure domain independent from the production VM and TLS-protected transport;
- unique immutable object keys and create-if-absent/no-overwrite behavior;
- streaming upload or a bounded multipart protocol with explicit finalize/cancel behavior;
- trusted upload completion metadata or exact-key metadata/HEAD that reports object size and a documented provider-computed checksum (or version identity plus a separately documented integrity method);
- bounded request/retry behavior and visible quota/capacity status;
- an auditable exact object identity, including namespace/account/region, key, and version ID when applicable;
- versioning/immutability/lifecycle semantics and safe handling of abandoned multipart uploads.

Do not treat an ETag as SHA-256 unless the chosen provider explicitly documents that exact upload mode's semantics. Local SHA-256 and byte count bind the bytes sent; compare against a documented provider checksum when available. User-supplied metadata that merely echoes the local hash is not an independent remote integrity check. If the provider cannot expose trustworthy exact-object evidence, production activation is blocked pending an approved alternative verification method.

Provider-specific differences in multipart, conditional create, checksums, metadata permissions, version IDs, and abort behavior can change the adapter and IAM policy. Therefore provider/account/region selection is an implementation entry gate for the production adapter, not a reason to choose a provider in this plan.

### 8.2 Three separate storage principals

| Principal | Allowed contract | Explicitly denied |
|---|---|---|
| Routine writer | Create the archive and manifest under the backup prefix; finalize upload; inspect metadata for those exact object keys only. Prefer one identity if policy can scope both archive and manifest writes and exact-object metadata. | Arbitrary read/list, delete, lifecycle, account/bucket administration, decryption, DB DDL/write, and unrelated prefixes. |
| Restore reader | Read a specified backup prefix/artifact/manifest, with no write permission. | Write, delete, lifecycle, and administration. The reader is not automatically the private-key custodian. |
| Lifecycle identity | Apply approved expiry/deletion/legal-hold and incomplete-multipart cleanup policy. | DB credentials, private decryption identity, backup write unless a provider lifecycle mechanism requires a narrowly scoped control. |

Manifest upload may use the same writer identity only if the selected provider can scope it to create-only operations in the same backup prefix plus exact-object metadata inspection. If the provider requires broad list/read/delete/admin rights for this, stop and obtain a narrower principal or a separate narrowly scoped manifest-writer identity. Do not widen routine writer permissions to compensate for provider limitations.

The writer never deletes completed or partial objects. Incomplete multipart uploads are handled by provider lifecycle/abort policy under the separate lifecycle identity. A completed orphan without a valid manifest is not a recovery generation; later cleanup is governed by the approved lifecycle/deletion policy, not by writer privileges.

## 9. Artifact identity and manifest ID

**ENGINEERING DECISION / PROPOSAL:** use the immutable manifest object key as the canonical `manifest_id`, not a digest of manifest bytes. Example:

```text
manifest_id = backups/v1/runs/<run_id>/manifest.json
archive_key = backups/v1/runs/<run_id>/database.pgdump.age
```

`run_id` is a new random UUID for every attempted run. Both keys are unique within a configured logical storage namespace. The full immutable manifest identity is `(storage_namespace_id, manifest_id, provider_version_id-if-supported)`. Never reuse a key for retry; retry means a new run ID. The manifest binds the run ID and exact archive key/version, ciphertext SHA-256/length, snapshot timestamp, recipient key ID, build SHA, and migration-ledger evidence. The manifest ID is not self-referential and does not depend on the manifest content digest.

The verifier computes the manifest's own SHA-256 from its exact retrieved bytes and records it in a separate verification receipt; the manifest does not contain its own digest. Canonical JSON byte rules should be fixed before implementation (UTF-8, no BOM, versioned field set, no duplicate keys); exact bytes are hashed. This avoids introducing a digest-canonicalization dependency while making any byte changes detectable.

## 10. Versioned manifest contract

The following is a planning-level schema contract, not a checked-in runtime schema. `schema_version` begins at `1`; unknown versions fail closed. Required values may not be silently replaced by empty strings or fabricated defaults.

```json
{
  "schema_version": 1,
  "manifest_id": "backups/v1/runs/<run_id>/manifest.json",
  "run_id": "<random UUID>",
  "storage_namespace_id": "<non-secret configured logical ID>",
  "source": {
    "logical_database_id": "<non-secret configured ID>",
    "postgres_server_version": "<exact server version>",
    "postgis_version": "<exact extension version>",
    "app_build_sha": "<source/build SHA>",
    "migration_ledger": [
      { "version": "0001", "name": "...", "checksum": "<sha256>" }
    ]
  },
  "times_utc": {
    "run_started_at": "<RFC3339 UTC>",
    "snapshot_started_at": "<RFC3339 UTC conservative transaction timestamp>",
    "dump_finished_at": "<RFC3339 UTC>",
    "encryption_finished_at": "<RFC3339 UTC>",
    "archive_upload_completed_at": "<RFC3339 UTC>",
    "manifest_publish_started_at": "<RFC3339 UTC>"
  },
  "dump": {
    "format": "pg_dump-custom",
    "pg_dump_version": "<exact PG16 client version>",
    "no_owner": true,
    "no_privileges": true,
    "result": "success"
  },
  "encryption": {
    "format": "age-v1-or-approved-versioned-equivalent",
    "recipient_key_ids": ["sha256:<public-recipient-fingerprint>"],
    "result": "success",
    "private_identity_available_to_writer": false
  },
  "archive": {
    "object_key": "backups/v1/runs/<run_id>/database.pgdump.age",
    "provider_version_id": "<if supported>",
    "encrypted_bytes": 0,
    "encrypted_sha256": "<lowercase hex>",
    "provider_checksum": { "algorithm": "<documented algorithm>", "value": "<value>" },
    "upload_result": "success",
    "remote_integrity_result": "verified"
  },
  "structural_archive_check": "deferred_to_controlled_verifier",
  "completion_state": "complete"
}
```

The exact schema must not include table rows, application payloads, admins, coordinates, free text, secrets, passwords, private key material, credential-bearing URLs, internal connection strings, or storage credential values. The migration ledger may include only version/name/checksum and must not include row data. `logical_database_id`, `storage_namespace_id`, and build identifiers are non-secret configured identifiers.

`manifest_publish_started_at` records when publication was attempted, not proof of the remote commit time. The exact manifest object/version and its digest are captured by the caller/verification receipt. `completion_state: complete` means the **producer pipeline** completed and the archive object passed the specified remote integrity check. It does not claim decryption, `pg_restore --list`, or a restore drill passed. A later recovery/release gate requires a controlled verification receipt bound to this manifest.

## 11. State machine and failure semantics

```text
PREFLIGHT
  → LOCKED
  → SNAPSHOT_OPEN
  → DUMP_ENCRYPT_UPLOAD
  → ARCHIVE_FINALIZED
  → ARCHIVE_EXACT_METADATA_VERIFIED
  → MANIFEST_PUBLISHING
  → MANIFEST_EXACT_METADATA_VERIFIED
  → COMPLETE
```

`skipped_overlapping` is a separate terminal outcome from `PREFLIGHT` if the advisory lock is unavailable. Any failed stage goes to `INCOMPLETE`; it is never represented by a complete manifest. The exact successful state transition is monotonic; no retry edits or overwrites a prior run.

| Failure boundary | Required behavior |
|---|---|
| Preflight / missing limit / missing credentials | Fail before snapshot; emit a bounded, secret-free reason code; no artifact or manifest. |
| Lock contention | Return `skipped_overlapping`; no snapshot, child process, upload, or manifest. |
| Snapshot acquisition / DB connection loss | Roll back/close exporter transaction; cancel child/upload; no manifest. |
| Partial dump, nonzero `pg_dump`, stdout error | Stop encryption and upload, collect child status, cancel upload, close transaction; no manifest. |
| Encryption child error/nonzero exit | Fail the pipeline even if `pg_dump` exited zero; cancel upload and close snapshot; no manifest. |
| Upload/multipart failure or ambiguous finalize | Cancel/abort upload where provider supports it; do not publish manifest. Any completed orphan remains untrusted and is handled only by lifecycle policy. |
| Snapshot maximum timeout / SIGTERM / SIGINT | Stop accepting pipeline bytes; propagate termination; allow bounded grace, then force-kill remaining children; roll back/close exporter; cancel upload; no manifest; release lock/connection. |
| Remote size/checksum unavailable or mismatch | Do not publish manifest; retain no `complete` state. Do not claim success based on local hash alone. |
| Manifest create/finalize/verification failure | Return failure; never overwrite an existing manifest key. If outcome is ambiguous, leave it for exact-key controlled verification; no success claim until known. |
| Process crash | DB socket closure releases transaction and advisory lock; partial multipart is covered by separate provider lifecycle policy. Object without a verified manifest is not a recovery generation. |

Completed archives or manifests that are orphaned after a crash are not deleted by the writer. Cleanup is a later approved lifecycle operation. The only complete-generation commit marker is the exact immutable manifest object whose referenced archive was already verified.

## 12. Process and pipeline supervision

**ENGINEERING DECISION / PROPOSAL:** implement explicit subprocess orchestration (for example, Node `child_process.spawn` plus stream pipelines), not a shell `pg_dump | age | upload` command. A shell `pipefail` is easy to omit or alter and does not, by itself, provide robust child cancellation, per-stage exit collection, upload finalize semantics, or resource cleanup. The orchestrator must:

- spawn without a shell and collect every child exit code/signal and bounded stderr separately;
- pipe bytes without logging them; redact or suppress credential-bearing diagnostics and never log connection strings;
- treat any child failure, broken stream, rejected upload, remote mismatch, or timeout as a whole-pipeline failure;
- on SIGTERM/SIGINT, stop input, propagate termination to all children, cancel the upload, then escalate to kill after a bounded grace period;
- wait for all children, roll back/close the exporter, dispose of ephemeral secret/config files, and release the lock on every path;
- keep only aggregate metadata/checksums/counters in structured logs, not archive content, table names/rows, secrets, or citizen data.

No production timeout or retry count is set here. Phase C defines scheduling and retry timing against the one-shot result. The producer is idempotent with respect to object identity by using a new run ID and create-if-absent keys; retry never overwrites a prior key.

## 13. Pre-migration verification interface

Phase B exposes an exact `manifest_id` from successful one-shot output and the secret-free manifest fields needed by a later controlled release gate. The later verifier receives one exact manifest identifier as input; it must not select “latest” by broad listing or infer a matching archive by timestamp.

The controlled verifier (later Phase D/release-gate work) uses a read-only restore-reader identity and controlled private identity to:

1. fetch that exact manifest object and capture its exact provider version and SHA-256;
2. validate the manifest schema/version, namespace, run ID, immutable manifest key, and that the archive key embeds the same run ID;
3. fetch the exact archive object/version; compute SHA-256 and encrypted byte count; compare local values with manifest and provider-documented checksum/version metadata;
4. verify the recorded recipient/key ID is one available to the approved recovery identity; decrypt only in the controlled verification environment;
5. run `pg_restore --list` on the decrypted stream/ephemeral controlled representation and record PG tool version and result; this is structural inspection, not a restore drill;
6. check snapshot freshness against the warning threshold in the canonical parent plan and capture verification time. Under the current approved threshold, age `≤18h` passes this pre-migration gate and age `>18h` blocks a production DB migration. This is stricter than the separate hard recovery/RPO requirement of `≤24h`: exactly 24h remains within the RPO limit but is not acceptable for the migration-artifact gate; age `>24h` is an RPO violation as well as a migration-gate rejection. The parent plan remains authoritative if its threshold is later changed;
7. write a separate verification receipt binding manifest ID/digest, archive key/version/hash/bytes, key ID, snapshot timestamp, verification result/time, `pg_restore` version, and evidence references.

No writer-side decryption. No full restore on every migration is implied. Phase D/E define the full restore drill and target-class RPO/RTO proof. The exact storage for the separate receipt and release automation is not selected here.

## 14. Capacity and resource evidence plan

The approved target class is Ubuntu 24.04, 2 vCPU, 4 GB RAM, 250 GB disk; that does not prove capacity. Before production activation, measure on that class or a demonstrably equivalent isolated system:

- current database logical and physical size, growth, and WAL rate;
- unencrypted logical custom-dump size and encrypted artifact size;
- dump, encryption, upload, and total duration under representative data;
- CPU, peak RSS, connection use, temporary/disk high-water, and network throughput;
- PostgreSQL vacuum/removable-row impact during the longest snapshot;
- application and concurrent import latency/error impact;
- bounded local disk consumption and the projected 30-day off-host footprint using approved retention;
- safety margin against the six-hour backup cadence and RPO ≤24h.

Record environment class, workload/fixture, tool versions, raw measurements, thresholds, and outcome. No live DB, target host, archive size, throughput, or capacity result is established by this planning checkpoint. If target-class measurements fail, stop production activation and return to owner/engineering decisions; do not claim sufficiency from a successful small CI fixture.

## 15. Phase B test strategy

Unit mocks are useful but are not sufficient. Future Phase B validation must use disposable PostgreSQL 16/PostGIS integration tests and a local/fake storage adapter; no real cloud credential or provider account is needed for CI.

Required test groups:

1. **Privileges/schema:** full current-schema `pg_dump -Fc` as `lighting_backup`; verify current tables/sequences; prove future missing grant/object causes visible nonzero failure; preserve negative tests for write/DDL/escalation.
2. **Snapshot correctness:** exported snapshot imported by `pg_dump`; concurrent writes around acquisition yield a consistent archive at the recorded snapshot; the exporter stays open until dump completes; test one-session lock contention and release on success, failure, timeout, and connection loss.
3. **Archive:** PG16 custom archive is nonempty and `pg_restore --list` works in disposable test; restore ownership/ACL behavior is compatible with later `--no-owner --no-acl` path.
4. **Encryption/stream:** synthetic age recipient round-trip in isolated CI; wrong private identity, truncated/corrupt ciphertext, missing recipient, and nonzero encryptor exit fail; test ciphertext digest/count; prove no plaintext persistent artifact or plaintext storage upload.
5. **Pipeline failures:** inject `pg_dump` child failure, encryption child failure, broken stream, storage failure, partial upload, ambiguous finalize, checksum mismatch, exact metadata unavailable, timeout, SIGTERM/SIGINT; assert every child/transaction/upload cleans up and no manifest is published.
6. **Manifest:** manifest is published last only after remote verification; fields bind exact run/object/key/build/migration snapshot; wrong run/object/hash/key ID is rejected; create-if-absent collision never overwrites; verify no secret/private data enters manifest/logs.
7. **Configuration, freshness, and resource bounds:** missing/invalid max fails before snapshot acquisition; short synthetic maximum triggers cleanup; all counters and buffers remain bounded by the selected adapter protocol. The future controlled verifier must test snapshot age exactly 18h (accepted under the current threshold), just over 18h (rejected for migration), exactly 24h (within hard RPO but rejected for migration freshness), and just over 24h (hard RPO violation and migration rejection). These freshness checks must derive their threshold from the canonical parent-plan contract rather than independently redefining it.

Tests should assert zero storage calls for failures before upload admission, zero manifest calls before archive verification, and no false `complete` on any stage failure. CI must use synthetic credentials and process-egress containment appropriate to the fake provider; it must not contact live cloud storage, AUSEMIO, CARTO, Geoapify, or another application provider.

## 16. Storage adapter boundary

**PROPOSAL:** a small adapter is justified because the orchestrator needs deterministic stream-failure tests and provider-specific semantics must stay outside the orchestration core. Keep only these operations:

```text
createImmutableObject(key, metadata) → upload stream/session
finalizeUpload(session) → exact object identity + documented completion metadata
verifyExactObject(identity) → size + trusted provider checksum/version evidence
publishManifestCreateOnly(key, bytes) → exact manifest identity + metadata
abortIncompleteUpload(session) → result (only if provider supports it)
```

Do not add generic list, arbitrary get, delete, lifecycle, bucket administration, multipart policy DSL, or cross-provider compatibility framework. Keep a fake adapter for CI. The selected provider's conditional-create, checksum, multipart, permissions, and lifecycle behavior must be mapped before implementing the production adapter; if those semantics cannot meet §8.1 with a narrow writer, production adapter implementation is blocked.

## 17. Phase B / Phase C interface

Phase B's one-shot command should have a stable machine-readable result and exit contract, for example:

| Result | Meaning | Phase C treatment |
|---|---|---|
| `complete` / exit `0` | Archive and manifest exact-object checks succeeded; producer pipeline completed. | Record manifest ID; separate verifier/recovery status still applies. |
| `skipped_overlapping` / documented nonzero-or-distinct exit | Backup lock already held; no work started. | Do not treat as a failed artifact; scheduler may record overlap. Exact numeric code is frozen during implementation. |
| `incomplete` / nonzero | Any required producer stage failed; no verified manifest. | Retry policy belongs to Phase C; new run ID on every attempt. |
| `preflight_rejected` / nonzero | Required config, key ID, permissions, or evidence precondition invalid. | Do not blind-retry; operator action required. |

The result contains no secret and reports the run ID, stable state/reason code, durations, snapshot UTC if acquired, exact manifest ID only if verified, archive encrypted bytes/SHA-256, key ID, and build/migration identifiers. Phase C owns timers, backoff, retry policy, persistent scheduler history, and operational alerting. It must call the same one-shot entry point and rely on its DB lock/create-only keys; no systemd timer is implemented in Phase B.

## 18. Explicit gate matrix and carried items

| Gate | Classification | Blocks | May proceed before closure |
|---|---|---|---|
| Off-host storage provider/account/region and object semantics | **DECISION REQUIRED — INFRASTRUCTURE** | Production adapter, credentials, uploads, activation | Provider-neutral plan, fake adapter, local orchestration tests. |
| Encryption-key custody/recovery authority and location | **DECISION REQUIRED — OWNER/INFRASTRUCTURE** | Production encryption activation and recovery readiness | Candidate compatibility research and synthetic key tests. |
| Storage credential issuance and principal policy | **DECISION REQUIRED — INFRASTRUCTURE** | Production upload | Define minimum writer/reader/lifecycle privileges; fake tests. |
| Backup-copy deletion/legal hold | **DECISION REQUIRED — OWNER/LEGAL/INFRASTRUCTURE if applicable** | Storage lifecycle activation | Writer has no delete; design immutable keys and record requirements. |
| Target-class capacity and workload results | **EVIDENCE REQUIRED** | Production snapshot max, schedule/capacity claims, activation | CI fixtures and measurement harness planning. |
| `BACKUP_MAX_SNAPSHOT_LIFETIME` | **EVIDENCE REQUIRED**; operationally configured after measurement | Production snapshot acquisition must fail closed until set | Synthetic short-limit timeout tests. |
| Provider checksum/version/create-only/multipart behavior | **EVIDENCE REQUIRED after provider selection** | Production adapter and complete-state claim | Fake adapter contract tests. |
| Encryption implementation/version and public-key fingerprint behavior | **EVIDENCE REQUIRED** | Production encryption/manifest key IDs | Candidate review and synthetic compatibility tests. |
| Backup egress connectivity/restriction | **EVIDENCE REQUIRED — INFRASTRUCTURE** | Production upload | Offline fake-provider tests. |
| Manifest ID/schema, process placement, subprocess model, adapter shape | **ENGINEERING PROPOSAL** | Independent review before implementation; not an owner/product gate | Plan review and test design can proceed. |

**Carried Phase A P2:** `database/production/create-maintenance-roles.psql` commits role creation before interactive `\password` prompts. An interruption can leave reserved names that intentionally stop automatic rerun; DBA inspection/manual resolution is required. Phase B does not change that provisioning behavior.

**Out of scope / unchanged:** Phase C scheduling/retries; Phase D restore execution; Phase E target-class RPO/RTO drill; Phase F destructive retention; Phase G monitoring; production DB/schema/migration changes; live backup run; cloud account/credential/key creation; AUSEMIO access or write; application provider traffic; inventory automatic geocoding (remains off); service `16` / CSS implementation (remains out of scope).

## 19. References and evidence boundary

### Repository evidence

- Production topology/secrets: [`docker-compose.production.yml`](../../../docker-compose.production.yml), [`docs/deployment/production-foundation.md`](../../deployment/production-foundation.md).
- Maintenance grants: [`database/production/grant-maintenance-roles.sql`](../../../database/production/grant-maintenance-roles.sql), provisioning scripts under [`database/production/`](../../../database/production/).
- Migration ledger and explicit runner: [`backend/src/db/migrate.ts`](../../../backend/src/db/migrate.ts), migrations under [`backend/src/db/migrations/`](../../../backend/src/db/migrations/).
- Disposable PG evidence: [CI workflow](../../../.github/workflows/ci.yml), [production foundation integration tests](../../../backend/tests/integration/productionFoundation.postgres.test.ts).
- Approved database operations boundary: [canonical parent plan](database-operations-recovery-retention-plan.md).

### Official upstream documentation

- PostgreSQL 16 [`pg_dump`](https://www.postgresql.org/docs/16/app-pgdump.html): custom archive, stdout, snapshot option, version constraints, and dump behavior.
- PostgreSQL 16 [snapshot synchronization functions](https://www.postgresql.org/docs/16/functions-admin.html#FUNCTIONS-SNAPSHOT-SYNCHRONIZATION): `pg_export_snapshot()` lifetime and import rules.
- PostgreSQL 16 [`SET TRANSACTION`](https://www.postgresql.org/docs/16/sql-set-transaction.html) and [transaction isolation](https://www.postgresql.org/docs/16/transaction-iso.html): snapshot import timing and repeatable-read semantics.
- PostgreSQL 16 [routine vacuuming](https://www.postgresql.org/docs/16/routine-vacuuming.html): long-running transactions and vacuum considerations.
- [age upstream project](https://github.com/FiloSottile/age) and [age format specification](https://c2sp.org/age): recipient/identity model and streaming/encryption format. These are candidate references, not a selected production dependency or key-management decision.

No cited documentation establishes this repository's live database size, target-host capacity, storage provider/account, private-key custody, or production recovery readiness. Those remain explicit evidence/decision gates above.

---

**Checkpoint result:** `READY FOR INDEPENDENT PLAN AUDIT` — planning only; no code, runtime configuration, database schema, dependency, credential, provider, deployment, backup artifact, or production data was changed or accessed.
