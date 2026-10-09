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

The archive should stream from `pg_dump` through a reviewed recipient-encryption process and into a narrowly scoped storage adapter. Plaintext archive bytes must not be written to persistent host storage. The routine writer may use the public encryption recipient and the `lighting_backup` and storage-writer credentials, but must never have the private decryption identity. Backup-vs-backup serialization uses a backup-only lock; backup-vs-migration serialization separately reuses the canonical migration advisory-lock identity. The manifest's migration ledger is read inside the same exported snapshot used by `pg_dump`. A manifest object is the producer-side commit marker; it does not mean that a restore drill has passed. A separately controlled verifier must bind one manifest to one exact encrypted object, verify/decrypt it, and inspect the archive before a future release gate relies on it.

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
| Migration workflow and lock | [`backend/src/db/migrate.ts`](../../../backend/src/db/migrate.ts) owns `schema_migrations`, checksum validation, `runMigrations`, and the pre-start `assertMigrationsCurrent` check. `runMigrations` and recognized-baseline adoption both use `withMigrationLock`, a session advisory lock with namespace `1701669235` and key `3`. Migrations are explicit; production HTTP startup does not apply them. Current SQL files are [`0001_initial_schema.sql`](../../../backend/src/db/migrations/0001_initial_schema.sql) and [`0002_p3_postgis_inventory.sql`](../../../backend/src/db/migrations/0002_p3_postgis_inventory.sql). There are no checked-in down migrations. |
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

No new application data table or migration is needed for this boundary. The migration ledger is read from the exporter transaction's exact snapshot and included in the manifest; it is not reread after that transaction closes. Build SHA and other process/build metadata come from the running process. Storage-result metadata is captured after upload. Snapshot-bound, process/build, and storage-result metadata are distinguished in §10.

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
3. On one dedicated exporter connection, first acquire a backup-only PostgreSQL session advisory lock for `backup ↔ backup` serialization. If already held, exit as `skipped_overlapping` without snapshot acquisition. This identity is distinct from every migration lock.
4. After the backup-only lock, non-blockingly acquire the canonical migration/schema-state session advisory lock used by the migration runner: namespace `1701669235`, key `3` (currently declared as `LOCK_NAMESPACE` / `LOCK_KEY` in `backend/src/db/migrate.ts`). Use the same two-integer lock identity, not a second migration-like key. If `pg_try_advisory_lock` fails because a migration/adoption is active, release the backup-only lock, return a stable `blocked_by_migration` outcome, and do not begin a transaction, export a snapshot, start `pg_dump`, or contact storage. Verify these calls with the exact `lighting_backup` role in disposable PostgreSQL before implementation.
5. Only after both locks are held, set UTC session timezone and begin `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`. In this exporter transaction, record `transaction_timestamp()` rendered in UTC and obtain `pg_export_snapshot()`. Then read `schema_migrations(version, name, checksum) ORDER BY version` in the same transaction. That exact result is the manifest's snapshot-bound migration ledger. A missing/inaccessible ledger, query error, malformed row, or inability to bind it to this transaction fails the run and prevents a complete manifest.
6. Read PostgreSQL server and PostGIS version metadata through the same exporter connection/transaction while the migration barrier is held. These DB/extension facts are therefore collected from the protected source state, not queried later from an unrelated connection. The application build SHA, `pg_dump` executable version, and static process configuration are process/build metadata; upload checksum/version/size are storage-result metadata.
7. Keep the exporter transaction and both locks while PG16 `pg_dump` connects as `lighting_backup` with the same database and `--snapshot=<exported-id> --format=custom --no-owner --no-privileges`, no `--file` output path, and no parallel jobs. Pipe stdout directly to the encryptor. The exporter transaction and shared migration barrier remain alive until `pg_dump` has finished consuming the snapshot and its success/failure is known.
8. After dump completion/failure and after all snapshot-bound metadata is fixed, commit or roll back the exporter transaction and release only the shared migration/schema-state lock. On dump failure, timeout, connection loss, or signal, first stop/collect dependent children and cancel upload; no manifest is created. Keep the separate backup-only lock through the remainder of one-shot cleanup and, on success, encryption, upload finalization, remote verification, and manifest publication.
9. On successful dump/encryption/upload, verify the exact archive object's provider metadata and checksum/size. Only then publish the manifest using a unique create-if-absent key and verify that exact manifest object. Releasing the shared migration lock before these later steps is safe only because the dump has consumed the snapshot and all DB snapshot-bound metadata is already fixed; the backup-only lock still prevents a second backup run.

The lock order is always `backup-only lock → canonical migration/schema-state lock → snapshot`. Current `withMigrationLock` holds only the canonical migration lock and never requests the backup-only lock. The backup uses a non-blocking attempt for the canonical lock and releases its first lock immediately on failure, so it cannot wait in a cycle with the current migration runner. A migration that begins after backup has acquired the canonical lock waits until the dump releases it.

PostgreSQL documents that an exported snapshot can be imported only while its exporting transaction remains open; `SET TRANSACTION SNAPSHOT` must occur before the importing transaction's first query and requires a suitable isolation level ([snapshot synchronization](https://www.postgresql.org/docs/16/functions-admin.html#FUNCTIONS-SNAPSHOT-SYNCHRONIZATION), [`SET TRANSACTION`](https://www.postgresql.org/docs/16/sql-set-transaction.html)). `REPEATABLE READ` uses one stable snapshot for the transaction ([transaction isolation](https://www.postgresql.org/docs/16/transaction-iso.html)). The transaction timestamp may precede the exact snapshot instant slightly; treat it as a conservative timestamp, not a precision claim.

### 5.2 Two lock purposes and Phase C interaction

The **backup-only lock** serializes `backup ↔ backup` and remains held for the full one-shot, including encryption/upload/finalization/cleanup. The **shared migration/schema-state barrier** is exactly the existing migration runner's namespace `1701669235`, key `3`; it serializes `backup dump ↔ migration` and is held only from before snapshot acquisition through the end of `pg_dump` snapshot consumption and capture of snapshot-bound metadata. It is released before encryption tail completion, remote upload finalization, remote metadata verification, and manifest publication. The two purposes and lifetimes must not be conflated.

Current `runMigrations` and `adoptRecognizedPreP3Database` both call `withMigrationLock` and hold the canonical session lock while applying/recording migrations (`backend/src/db/migrate.ts`). The backup must interoperate with that identity. Future Phase C scheduling must call the same one-shot command/lock contract and must not introduce a second conflicting migration lock. A DB connection loss releases session locks naturally; the orchestrator still must terminate `pg_dump` and dependent children and must not publish a manifest.

**EVIDENCE REQUIRED:** prove with disposable PG16 that `lighting_backup` can use `pg_try_advisory_lock` for the canonical identity, that a migration holding it excludes the backup before snapshot acquisition, that backup holding it blocks migration through dump completion, and that both locks release correctly on success/failure/timeout/signals. No schema permission change should be assumed necessary.

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

Manifest metadata has three categories: **snapshot-bound database metadata** (`schema_migrations` rows plus PostgreSQL/PostGIS versions captured through the exporter session under the migration barrier); **process/build metadata** (`app_build_sha`, `pg_dump` executable version, static configuration); and **storage-result metadata** (archive key/version, ciphertext bytes/hash, provider checksum, upload and verification results). The future intended migration version/checksum belongs to separate release-orchestration evidence; it is not part of the backup manifest because that migration has not yet been applied to this pre-migration database state.

`manifest_publish_started_at` records when publication was attempted, not proof of the remote commit time. The exact manifest object/version and its digest are captured by the caller/verification receipt. `completion_state: complete` means the **producer pipeline** completed and the archive object passed the specified remote integrity check. It does not claim decryption, `pg_restore --list`, or a restore drill passed. A later recovery/release gate requires a controlled verification receipt bound to this manifest.

## 11. State machine and failure semantics

```text
PREFLIGHT
  → BACKUP_ONLY_LOCKED
  → MIGRATION_BARRIER_HELD
  → SNAPSHOT_OPEN_WITH_LEDGER_BOUND
  → DUMP_ENCRYPT_UPLOAD
  → DUMP_COMPLETE_AND_MIGRATION_BARRIER_RELEASED
  → ARCHIVE_FINALIZED
  → ARCHIVE_EXACT_METADATA_VERIFIED
  → MANIFEST_PUBLISHING
  → MANIFEST_EXACT_METADATA_VERIFIED
  → COMPLETE
```

`skipped_overlapping` is a separate terminal outcome if the backup-only lock is unavailable. `blocked_by_migration` is a separate stable terminal outcome if the canonical migration barrier is unavailable; in that case there is no snapshot, dump, storage request, or manifest. Any failed stage goes to `INCOMPLETE`; it is never represented by a complete manifest. The exact successful state transition is monotonic; no retry edits or overwrites a prior run.

| Failure boundary | Required behavior |
|---|---|
| Preflight / missing limit / missing credentials | Fail before snapshot; emit a bounded, secret-free reason code; no artifact or manifest. |
| Backup-only lock contention | Return `skipped_overlapping`; no migration-barrier attempt, snapshot, child process, upload, or manifest. |
| Canonical migration barrier unavailable | Release backup-only lock and return `blocked_by_migration`; no snapshot, `pg_dump`, storage request, or manifest. |
| Snapshot acquisition / DB connection loss | Roll back/close exporter transaction; release migration barrier; cancel child/upload; release backup-only lock during cleanup; no manifest. |
| Snapshot ledger read fails or cannot be bound to exported snapshot | Roll back/close exporter transaction; release migration barrier and backup-only lock; no `pg_dump`, storage request, or manifest. |
| Partial dump, nonzero `pg_dump`, stdout error | Stop encryption and upload, collect child status, cancel upload, close/rollback transaction and release migration barrier; no manifest. |
| Encryption child error/nonzero exit | Fail the pipeline even if `pg_dump` exited zero; cancel upload and close snapshot; no manifest. |
| Upload/multipart failure or ambiguous finalize | Cancel/abort upload where provider supports it; do not publish manifest. Any completed orphan remains untrusted and is handled only by lifecycle policy. |
| Snapshot maximum timeout / SIGTERM / SIGINT while dump is active | Stop accepting pipeline bytes; propagate termination; allow bounded grace, then force-kill remaining children; roll back/close exporter; release migration barrier; cancel upload; no manifest; release both locks during cleanup. |
| Remote size/checksum unavailable or mismatch | Do not publish manifest; retain no `complete` state. Do not claim success based on local hash alone. |
| Manifest create/finalize/verification failure | Return failure; never overwrite an existing manifest key. If outcome is ambiguous, leave it for exact-key controlled verification; no success claim until known. |
| Process crash | DB socket closure releases both session locks and transaction; partial multipart is covered by separate provider lifecycle policy. Object without a verified manifest is not a recovery generation. |

Completed archives or manifests that are orphaned after a crash are not deleted by the writer. Cleanup is a later approved lifecycle operation. The only complete-generation commit marker is the exact immutable manifest object whose referenced archive was already verified.

## 12. Process and pipeline supervision

**ENGINEERING DECISION / PROPOSAL:** implement explicit subprocess orchestration (for example, Node `child_process.spawn` plus stream pipelines), not a shell `pg_dump | age | upload` command. A shell `pipefail` is easy to omit or alter and does not, by itself, provide robust child cancellation, per-stage exit collection, upload finalize semantics, or resource cleanup. The orchestrator must:

- spawn without a shell and collect every child exit code/signal and bounded stderr separately;
- pipe bytes without logging them; redact or suppress credential-bearing diagnostics and never log connection strings;
- treat any child failure, broken stream, rejected upload, remote mismatch, or timeout as a whole-pipeline failure;
- on SIGTERM/SIGINT, stop input, propagate termination to all children, cancel the upload, then escalate to kill after a bounded grace period;
- wait for all children; roll back/close the exporter when dump is incomplete; release the shared migration barrier immediately after dump completion and snapshot-metadata capture; dispose of ephemeral secret/config files; and release the backup-only lock on every exit path;
- keep only aggregate metadata/checksums/counters in structured logs, not archive content, table names/rows, secrets, or citizen data.

No production timeout or retry count is set here. Phase C defines scheduling and retry timing against the one-shot result. The producer is idempotent with respect to object identity by using a new run ID and create-if-absent keys; retry never overwrites a prior key.

## 13. Pre-migration verification interface

Phase B exposes an exact `manifest_id` and the snapshot-bound migration ledger from successful one-shot output. The controlled verifier receives one exact manifest identifier; it must not select “latest” by broad listing or infer a matching archive by timestamp.

The controlled verifier (later Phase D/release-gate work) uses a read-only restore-reader identity and controlled private identity to:

1. fetch that exact manifest object and capture its exact provider version and SHA-256;
2. validate the manifest schema/version, namespace, run ID, immutable manifest key, and that the archive key embeds the same run ID;
3. fetch the exact archive object/version; compute SHA-256 and encrypted byte count; compare local values with manifest and provider-documented checksum/version metadata;
4. verify the recorded recipient/key ID is one available to the approved recovery identity; decrypt only in the controlled verification environment;
5. run `pg_restore --list` on the decrypted stream/ephemeral controlled representation and record PG tool version and result; this is structural inspection, not a restore drill;
6. verify the manifest's ordered `schema_migrations(version, name, checksum)` is the exact ledger captured inside the archive's exported snapshot; and
7. write a separate verification receipt binding manifest ID/digest, archive key/version/hash/bytes, key ID, snapshot UTC, exact snapshot ledger, verification result/time, `pg_restore` version, and evidence references.

### 13.1 Pre-migration release gate and current-ledger comparison

The canonical [backup/RPO contract](database-operations-recovery-retention-plan.md#6-backup-strategy-and-rpo) and [release/migration contract](database-operations-recovery-retention-plan.md#10-release-migration-rollback-and-disaster-scenarios) require avoiding schema migration concurrently with a dump and taking a verified pre-migration dump before release orchestration applies a production schema migration. A recent timestamp alone does not prove the artifact represents the current schema state.

**FUTURE RELEASE-ORCHESTRATION CONTRACT (not implemented by Phase B):** the release gate must use one connected PostgreSQL `PoolClient` and one session that owns the canonical migration/schema-state advisory lock (namespace `1701669235`, key `3`) continuously from final artifact checks and current-ledger comparison through intended migration application. Its conceptual shape is:

```ts
await withMigrationLock(database, async (client) => {
  const verified = await verifyExactApprovedArtifactAndReceipt();
  assertSnapshotFreshness(verified, 18 /* hours */);
  const currentLedger = await readLedger(client);
  assertExactLedgerMatch(currentLedger, verified.snapshotLedger);
  await runMigrationsOnLockedClient(client);
});
```

The exact names and module boundaries may change during implementation, but the same-client/session semantics below are mandatory. Inside this one lock-owner callback it must:

1. verify/select the exact already-approved manifest/artifact and its matching verification receipt;
2. check freshness against the canonical warning threshold. The current threshold is snapshot age `≤18h`; an artifact `>18h` blocks migration. The separate hard RPO remains `≤24h`; exactly 24h is within the RPO requirement but is not acceptable for this release gate, and `>24h` is an RPO violation;
3. read the **current production** `schema_migrations(version, name, checksum)` on the callback's already locked `client`, in canonical order;
4. compare the current ledger exactly with the verified artifact's snapshot-bound ledger: same ordered version, name, and checksum for every row;
5. if equal, call the lock-aware migration primitive on that same `client` while retaining the canonical lock; record the intended migration version/checksum separately as release intent, not as part of the pre-migration backup manifest.

If the current ledger differs, the artifact is stale for this schema state even when its age is `≤18h`: do not call the migration primitive; fail closed and let the outer lock owner release the barrier/client in cleanup. Produce and verify a new pre-migration generation, then reacquire the barrier and repeat the current-ledger comparison before applying. Do not migrate against an age-valid but ledger-stale artifact. If the ledger cannot be read or compared exactly, fail closed. There must be no unlock/relock between comparison and migration, no second DB connection for migration execution, and no call to ordinary `runMigrations(database)` from inside this already locked callback.

#### 13.1.1 Current runner behavior and required lock-aware primitive

**CURRENT REPOSITORY FACT:** [`backend/src/db/migrate.ts`](../../../backend/src/db/migrate.ts) defines the canonical lock identity (`LOCK_NAMESPACE = 1_701_669_235`, `LOCK_KEY = 3`). `withMigrationLock(database, callback)` calls `database.connect()`, acquires the session advisory lock on that `PoolClient`, runs the callback with that client, then unlocks and releases it in `finally`. `runMigrations(database)` currently loads/validates the packaged migration chain and invokes `withMigrationLock`; its preflight, ledger checks, and migration application use the callback client. This is safe for ordinary standalone migration execution. It is not directly usable from a release gate which already owns the same session lock through another connection: calling it there would check out another client and attempt to acquire the lock again.

**FUTURE IMPLEMENTATION CONTRACT:** provide a lock-aware migration primitive equivalent to `runMigrationsOnLockedClient(client)`. Its required semantics are:

- input is one connected `PoolClient` whose session already owns the canonical migration advisory lock;
- it does not call `database.connect()`, acquire the canonical lock again, unlock the canonical lock, or release the supplied client;
- it performs the same canonical migration-chain validation, preflight, applied-ledger name/checksum validation, and migration application behavior required by current `runMigrations`;
- every migration/preflight/ledger query and transaction runs through the supplied lock-owning client;
- it owns migration logic and transaction/error handling, but not advisory-lock or client lifecycle.

Keep the ordinary standalone API conceptually as `runMigrations(database) → withMigrationLock(database, client => runMigrationsOnLockedClient(client))`. Existing callers continue to request a normal controlled migration without pre-acquiring a lock. The lock owner remains responsible for one lock acquisition and one client checkout. Implementation may extract/reuse the lock identity or adjust helper visibility so backup, release orchestration, and migration code cannot drift; this plan does not prescribe a source-level refactor or change the current API now.

#### 13.1.2 Lock ownership, transaction, and failure contract

The **outer lock owner** acquires the canonical advisory lock, owns the PostgreSQL session, performs release-gate artifact/freshness/current-ledger checks, invokes the lock-aware primitive on that same client, and unlocks/releases the client in `finally` only after migration success/failure handling has completed. The primitive owns migration checks, per-migration transactions, and canonical migration errors; it must not release or replace the supplied session.

Preserve current transaction behavior in `migrate.ts`: pending migrations are applied sequentially, each in its own `BEGIN`/`COMMIT`, with that migration's `ROLLBACK` and `MigrationError` handling on failure. Do not introduce a transaction around the entire migration chain. The session-level advisory lock remains held across each transaction boundary because it belongs to the PostgreSQL session, not an individual transaction.

If artifact verification, freshness, current-ledger reading, or exact comparison fails/mismatches, do not invoke the migration primitive; return a fail-closed release result and let the outer `finally` release the lock/client. If the primitive fails, preserve its canonical rollback/error semantics, report release failure, and still release the lock/client in the outer cleanup. Never start a second migration runner as recovery, and never let the primitive accidentally unlock or release the caller's session.

This is the release-orchestration interface, not Phase B implementation. No writer-side decryption and no full restore on every migration are implied. Phase D/E define restore execution and target-class RPO/RTO proof. The exact storage for the separate verification receipt and release automation is not selected here.

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
2. **Snapshot correctness:** exported snapshot imported by `pg_dump`; concurrent writes around acquisition yield a consistent archive at the recorded snapshot; exporter transaction stays open until dump completes; snapshot ledger is read in that same transaction and equals the ledger restored/visible from the archive; test both lock lifetimes and release on success, failure, timeout, and connection loss.
3. **Archive:** PG16 custom archive is nonempty and `pg_restore --list` works in disposable test; restore ownership/ACL behavior is compatible with later `--no-owner --no-acl` path.
4. **Encryption/stream:** synthetic age recipient round-trip in isolated CI; wrong private identity, truncated/corrupt ciphertext, missing recipient, and nonzero encryptor exit fail; test ciphertext digest/count; prove no plaintext persistent artifact or plaintext storage upload.
5. **Pipeline failures:** inject `pg_dump` child failure, encryption child failure, broken stream, storage failure, partial upload, ambiguous finalize, checksum mismatch, exact metadata unavailable, timeout, SIGTERM/SIGINT; assert every child/transaction/upload cleans up and no manifest is published.
6. **Manifest:** manifest is published last only after remote verification; fields bind exact run/object/key/build/snapshot-ledger; wrong run/object/hash/key ID/ledger is rejected; create-if-absent collision never overwrites; verify no secret/private data enters manifest/logs.
7. **Configuration, freshness, and resource bounds:** missing/invalid max fails before snapshot acquisition; short synthetic maximum triggers cleanup; all counters and buffers remain bounded by the selected adapter protocol. The future controlled verifier must test snapshot age exactly 18h (accepted under the current threshold), just over 18h (rejected for migration), exactly 24h (within hard RPO but rejected for migration freshness), and just over 24h (hard RPO violation and migration rejection). These freshness checks must derive their threshold from the canonical parent-plan contract rather than independently redefining it.

Tests should assert zero storage calls for failures before upload admission, zero manifest calls before archive verification, and no false `complete` on any stage failure. CI must use synthetic credentials and process-egress containment appropriate to the fake provider; it must not contact live cloud storage, AUSEMIO, CARTO, Geoapify, or another application provider.

### 15.1 Required migration-coordination and ledger-binding tests

These are additional disposable PostgreSQL 16/PostGIS integration acceptance tests; they are planning requirements only.

- **Test A — migration blocks backup:** hold the canonical migration lock (namespace `1701669235`, key `3`) as the migration runner, then start the backup. Assert `blocked_by_migration`, zero exported snapshot calls, zero `pg_dump` starts, and zero storage calls.
- **Test B — backup blocks migration:** let backup acquire the canonical barrier, open its exported snapshot, and hold a fake/controlled `pg_dump` active. Attempt the controlled migration runner and prove schema mutation cannot begin until dump completion and barrier release. Verify that the backup-only lock can remain held after the shared migration barrier is released.
- **Test C — snapshot-bound ledger:** in the exporter transaction, export the snapshot and read the ordered migration ledger. Use that snapshot for `pg_dump`; while the canonical barrier is held, a competing migration cannot alter schema/ledger. After the dump finishes and the migration barrier releases, restore or inspect the archive and prove its ledger equals both the captured manifest ledger and the ledger visible to that archive snapshot.
- **Test D — age-valid but ledger-stale artifact:** create a verified synthetic artifact with ledger state N, advance the disposable database ledger to N+1, keep artifact age within `≤18h`, and prove the future pre-migration gate rejects it because the ordered version/name/checksum rows differ.
- **Test E — matching release state and same-session execution:** use the real future release-gate path and lock-aware migration primitive against disposable PostgreSQL 16/PostGIS, not a mock lock/migration approximation. With an exact verified artifact/current-ledger match and snapshot age `≤18h`, prove the gate acquires the canonical lock on one client/session, records `pg_backend_pid()` (or equivalent) at comparison and migration execution, reads/compares the current ledger on that session, and applies the intended packaged migration through the same client without blocking on its own lock. A competing connection must be unable to acquire the canonical lock or interleave schema/ledger mutation during the interval. Assert session identity is unchanged, migration result/ledger is correct, and the lock is released only after migration application exits.
- **Test F — no nested runner/self-deadlock regression:** instrument the real disposable-PostgreSQL release-gate path with a bounded timeout and connection/lock-acquisition counters. Assert the outer gate checks out one lock-owning client, the lock-aware primitive uses that supplied client, and there is no second `database.connect()` or second canonical advisory-lock acquisition from inside the callback. Make an accidental call to ordinary `runMigrations(database)` fail promptly via the instrumentation/deadline; do not rely on an intentionally hanging test.
- **Test G — comparison-to-migration TOCTOU exclusion:** use a deterministic test barrier/instrumentation after the current-ledger comparison and before/during the intended migration. From a competing disposable PostgreSQL session, attempt canonical lock acquisition (or the controlled migration entry point). Prove it remains excluded and cannot mutate schema/ledger until the lock-aware migration path completes and the outer lock owner releases the session lock; then prove it can proceed. Bound all waits and assert the compared ledger and applied migration result.
- **Test H — migration failure cleanup on the owner session:** inject a controlled migration failure in disposable PostgreSQL. Assert canonical per-migration rollback/error behavior is preserved, no release success is reported, the lock-aware primitive neither unlocks nor releases/replaces the supplied client, and the outer owner releases the advisory lock/client in `finally` after failure handling. A competing session must then be able to acquire the lock; no second runner is started.

These tests must also prove that all rejected/failed paths release the appropriate lock(s) and that no artifact is represented as complete on mismatch.

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
| `skipped_overlapping` / documented nonzero-or-distinct exit | Backup-only lock already held; no migration-barrier attempt or work started. | Do not treat as a failed artifact; scheduler may record overlap. Exact numeric code is frozen during implementation. |
| `blocked_by_migration` / documented nonzero-or-distinct exit | The canonical migration/schema-state lock (namespace `1701669235`, key `3`) was held; backup released its own lock without snapshot, dump, or storage activity. | Do not treat as a completed or ordinary failed artifact; Phase C may retry under its separately approved retry policy. |
| `incomplete` / nonzero | Any required producer stage failed; no verified manifest. | Retry policy belongs to Phase C; new run ID on every attempt. |
| `preflight_rejected` / nonzero | Required config, key ID, permissions, or evidence precondition invalid. | Do not blind-retry; operator action required. |

The result contains no secret and reports the run ID, stable state/reason code, durations, snapshot UTC and snapshot-bound ledger if acquired, exact manifest ID only if verified, archive encrypted bytes/SHA-256, key ID, and process/build identifiers. Phase C owns timers, the canonical parent plan's one bounded retry after 15 minutes (without indefinite retry loops), persistent scheduler history, and operational alerting. It must call the same one-shot entry point and rely on both lock contracts—backup-only first, then the canonical migration/schema-state lock—and create-only keys; no systemd timer is implemented in Phase B.

## 18. Explicit gate matrix and carried items

| Gate | Classification | Blocks | May proceed before closure |
|---|---|---|---|
| Off-host storage provider/account/region and object semantics | **DECISION REQUIRED — INFRASTRUCTURE** | Production adapter, credentials, uploads, activation | Provider-neutral plan, fake adapter, local orchestration tests. |
| Encryption-key custody/recovery authority and location | **DECISION REQUIRED — OWNER/INFRASTRUCTURE** | Production encryption activation and recovery readiness | Candidate compatibility research and synthetic key tests. |
| Storage credential issuance and principal policy | **DECISION REQUIRED — INFRASTRUCTURE** | Production upload | Define minimum writer/reader/lifecycle privileges; fake tests. |
| Backup-copy deletion/legal hold | **DECISION REQUIRED — OWNER/LEGAL/INFRASTRUCTURE if applicable** | Storage lifecycle activation | Writer has no delete; design immutable keys and record requirements. |
| Target-class capacity and workload results | **EVIDENCE REQUIRED** | Production snapshot max, schedule/capacity claims, activation | CI fixtures and measurement harness planning. |
| `BACKUP_MAX_SNAPSHOT_LIFETIME` | **EVIDENCE REQUIRED**; operationally configured after measurement | Production snapshot acquisition must fail closed until set | Synthetic short-limit timeout tests. |
| Interoperability with canonical migration barrier and snapshot-bound ledger | **EVIDENCE REQUIRED** | Production dump/migration concurrency safety and release-gate acceptance | Disposable PG16 lock and ledger-binding tests A–E in §15.1. |
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
