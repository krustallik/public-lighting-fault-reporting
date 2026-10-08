# Production foundation operating notes

**Status:** repository production foundation only; deployment and production readiness are not approved by this document. No real provider key or AUSEMIO access is included.

This configuration builds separate public and admin static images plus a private API/database topology. A shared Nginx edge routes the two approved origins but does not package either application. It is intentionally separate from the root development Compose stack. Phase A now provisions separate database backup and retention identities with explicit grants and disposable PostgreSQL evidence. The retention identity is read-only in Phase A; destructive retention is not active. There is still no backup execution, encryption, off-host upload, restore tooling/drill, scheduled/destructive retention cleanup, monitoring integration, or target-host capacity result in this checkpoint.

## Approved topology

```text
Internet
  └─ Nginx :80/:443
       ├─ mapa.vra-ubuntu-server-0579.virtual.cloud.tuke.sk → private public-static image
       ├─ admin.mapa.vra-ubuntu-server-0579.virtual.cloud.tuke.sk → private admin-static image
       └─ same-origin /api → private Express :5000 → private PostgreSQL/PostGIS :5432
                                      └─ outbound HTTPS to fixed Geoapify EU endpoint
Public browser ── CARTO raster tiles
```

Only Nginx publishes host ports 80 and 443. Public and admin have separate static images/build artifacts and are independently replaceable behind the shared edge; their containers join only the private web network. The API has no host port, Postgres has no host port, Nginx cannot reach the database network, and migration/bootstrap one-shot services only join the database network. The API receives the runtime DB credential only. Exact host rules, API allowlists, forwarded-header replacement, no-store API behavior, bounded request size/temp paths, and edge-to-app routing are in `frontend/nginx/nginx.conf` and `frontend/nginx/snippets/api-proxy.conf`; each static image has its own SPA fallback in `frontend/nginx/static.conf`.

## Required host-provided configuration

Do not commit a production environment file, private key, DB password, JWT secret, or Geoapify key. The root `.gitignore` excludes `/secrets/` and `/.env.production`. Compose expects these values when the production stack is rendered or started:

| Setting | Purpose |
|---|---|
| `DB_NAME` | Production database name. |
| `DB_ADMIN_USER` | Initial DBA/superuser role used by the Postgres container; never used by the API. |
| `DB_ADMIN_PASSWORD_FILE` | File mounted for the Postgres initial admin password. Changing it does not rotate an already initialized database role. |
| `DB_RUNTIME_PASSWORD_FILE` | `lighting_runtime` password, mounted only into the HTTP API. |
| `DB_MIGRATION_PASSWORD_FILE` | `lighting_migrator` password, mounted only into the controlled migration service. |
| `DB_BOOTSTRAP_PASSWORD_FILE` | Temporary `lighting_bootstrap` credential. It defaults to an empty, fail-closed repository sentinel and should be overridden only for the one-shot bootstrap invocation. |
| `JWT_SECRET_FILE` | Canonical unpadded base64url encoding of at least 32 CSPRNG bytes. Runtime checks encoding/length and obvious defaults; it cannot prove entropy. |
| `GEOAPIFY_API_KEY_FILE` | Server-only key for public/report address suggestions. Do not set a live key until account/privacy/legal activation gates close. |
| `VITE_CARTO_PUBLIC_KEY` | Browser-visible CARTO key for the public build; restrict it at CARTO to the public hostname. It is not a server secret. |

The production runtime also requires the fixed origins, `TRUST_PROXY_CIDRS=172.30.0.2/32`, Geoapify enablement and bounded queue/timeout/rate/budget values, `NOMINATIM_AUTO_GEOCODE=false`, and `LOCAL_TEST_SUBMIT_ENABLED=false`; `docker-compose.production.yml` sets these explicitly. Optional overrides include `APP_BUILD_SHA`, `MIGRATION_VERSION`, `PUBLIC_BUILD_ID`, `ADMIN_BUILD_ID`, `HTTP_PORT`, `HTTPS_PORT`, `GEOAPIFY_TIMEOUT_MS`, `GEOAPIFY_MAX_ACTIVE`, `GEOAPIFY_MAX_PENDING`, `GEOAPIFY_START_INTERVAL_MS`, `GEOAPIFY_QUEUE_EXPIRY_MS`, `GEOAPIFY_DAILY_BUDGET`, and the `ADDRESS_IP_*` settings. Production bounds are validated by `backend/src/config/addressProvider.ts`.

Phase A does not add backup/retention Compose services, environment variables, or mounted secrets because no maintenance consumer exists yet. Future approved maintenance processes must use protected file-backed credentials; backup, retention and DBA credentials are explicitly rejected by the production HTTP configuration and must not be mounted into backend, migrations, bootstrap, or either static image. No secret placeholder or real maintenance credential is committed.

Generate a JWT secret without printing it into application logs, for example:

```sh
umask 077
openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n' > secrets/jwt-secret
```

Create secret files through the host's approved secret-management procedure, with file access compatible with Docker Compose's file-backed secret mounts and the non-root container users. Never pass a password/key as a CLI argument. TLS files must be supplied at `secrets/tls/tls.crt` and `secrets/tls/tls.key`; the certificate must cover both exact hostnames. DNS, issuance/renewal, firewall, and host ownership are infrastructure responsibilities, not automated here.

## Database roles and controlled schema setup

Use a fresh, disposable/non-production database to rehearse this sequence before an operational deployment:

1. Prepare the secret files and production Compose environment file outside Git. Start only Postgres:

   ```sh
   docker compose --env-file .env.production -f docker-compose.production.yml up -d db
   ```

2. Initial application-role provisioning is a one-shot, fail-on-collision operation. The reserved names `lighting_migrator`, `lighting_runtime`, and `lighting_bootstrap` must all be absent. If any name already exists, provisioning stops as a safety failure: investigate the role's provenance before any manual change. Do not bypass the guard with manual GRANTs, password changes, or role mutation, and do not adopt an unknown existing principal. This pre-production setup has no compatibility/takeover path for old roles.

   Copy the DBA-only psql script and both SQL files into the same directory because the script includes them relative to itself. `\password` prompts without placing passwords in SQL arguments/history. Record a temporary bootstrap password through the approved secret store so it can be supplied to the one-shot bootstrap container later.

   ```sh
   docker compose --env-file .env.production -f docker-compose.production.yml cp database/production/create-roles.psql db:/tmp/create-roles.psql
   docker compose --env-file .env.production -f docker-compose.production.yml cp database/production/assert-fresh-application-roles.sql db:/tmp/assert-fresh-application-roles.sql
   docker compose --env-file .env.production -f docker-compose.production.yml cp database/production/create-application-roles.sql db:/tmp/create-application-roles.sql
   docker compose --env-file .env.production -f docker-compose.production.yml exec -it db sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /tmp/create-roles.psql'
   ```

   The shared assertion refuses any reserved-name collision before role creation; the three fresh role creations are transactional. The script then prompts for their passwords, grants the migration role schema-only DDL capability, and preinstalls `pgcrypto` and PostGIS as the DBA. The migration role cannot create databases; the HTTP service never receives DBA credentials.

3. Build the backend, public static image, admin static image, and shared Nginx edge. The public build requires a CARTO public key but makes no CARTO request; the admin image has no CARTO configuration:

   ```sh
   docker compose --env-file .env.production -f docker-compose.production.yml build backend public-app admin-app nginx
   ```

4. Run the controlled migration profile as `lighting_migrator`, then apply the explicit runtime/bootstrap grants as DBA:

   ```sh
   docker compose --env-file .env.production -f docker-compose.production.yml --profile release run --rm migrations
   docker compose --env-file .env.production -f docker-compose.production.yml cp database/production/grant-application-roles.sql db:/tmp/grant-application-roles.sql
   docker compose --env-file .env.production -f docker-compose.production.yml exec -it db sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /tmp/grant-application-roles.sql'
   ```

   Reapply/review the grants file after any future schema change. Before changing owners or grants, it verifies the DBA identity, all three roles' LOGIN and restricted role attributes, and the absence of role memberships in either direction. A failed check is a safety stop; inspect and resolve the role state explicitly before retrying. New objects need an explicit runtime permission review; the runtime role has no database/schema DDL authority or privileged memberships.

5. Provision the separate maintenance identities as a controlled DBA after migrations and the application grants have succeeded. The reserved names `lighting_backup` and `lighting_retention` must both be absent; an existing name is a stop for provenance investigation, never an invitation to adopt or repair it. Copy the psql script and both adjacent SQL files together, then run it on the interactive trusted terminal:

   ```sh
   docker compose --env-file .env.production -f docker-compose.production.yml cp database/production/create-maintenance-roles.psql db:/tmp/create-maintenance-roles.psql
   docker compose --env-file .env.production -f docker-compose.production.yml cp database/production/assert-fresh-maintenance-roles.sql db:/tmp/assert-fresh-maintenance-roles.sql
   docker compose --env-file .env.production -f docker-compose.production.yml cp database/production/create-maintenance-roles.sql db:/tmp/create-maintenance-roles.sql
   docker compose --env-file .env.production -f docker-compose.production.yml exec -it db sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /tmp/create-maintenance-roles.psql'
   ```

   The two role creations are one transaction. Separate `\password` prompts occur after commit so passwords are not embedded in SQL, arguments, shell history, or logs. Generate and retain each credential only through the approved restricted file-backed secret process for a future maintenance consumer; there is no consumer or Compose mount in this phase. If interrupted after role creation but before both passwords are assigned, the reserved names intentionally block an automatic rerun. A DBA must inspect the exact roles/provisioning state and resolve it explicitly; do not automatically drop, adopt, normalize, or change an unknown principal.

6. Apply the explicit maintenance grants as a controlled DBA after every migration and after reviewing the allowlist against the current schema:

   ```sh
   docker compose --env-file .env.production -f docker-compose.production.yml cp database/production/grant-maintenance-roles.sql db:/tmp/grant-maintenance-roles.sql
   docker compose --env-file .env.production -f docker-compose.production.yml exec -it db sh -lc 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /tmp/grant-maintenance-roles.sql'
   ```

   `lighting_backup` receives SELECT on the current full database application/ledger table allowlist and read access to its current sequences. The grant script verifies that every expected object exists and grants no future default privileges: a future logical backup must fail visibly if its object allowlist is stale or access is missing. In Phase A, `lighting_retention` is read-only and can SELECT only the approved eligibility columns: `id`/`created_at` on `admin_activity_logs`; `id`/`created_at`/`import_batch_id` on `inventory_audit_events`; `id`/`status`/`completed_at` on `import_batches`; `batch_id`/`outcome` on `import_batch_rows`; and `id`/`expires_at` on `admin_refresh_sessions`. It has no DELETE privilege on any current table. Reapplying the grant file first revokes existing table, sequence, and column grants before rebuilding the allowlists, removing any stale DELETE grants. Destructive authority will be introduced only with Phase F's independently audited DB-side eligibility enforcement for the one-year cutoff, terminal import-batch status and completion time, pending-row protection, retained audit references, expired refresh sessions, import cascade/cardinality safety, and approved table/category allowlist. The enforcement mechanism remains undecided until Phase F evidence is reviewed. `integration_logs` retention remains OWNER DECISION REQUIRED and inaccessible for DELETE. The grant file contains no permissive default privileges, backup pipeline, or cleanup algorithm. Review and deliberately reapply it after schema changes; new tables remain denied by default.

7. Run the first-admin profile only when a temporary bootstrap password file contains the same credential assigned to `lighting_bootstrap`. Create `.env.production.bootstrap` as a temporary copy of the production env file plus the `DB_BOOTSTRAP_PASSWORD_FILE` override; do not put that override in the normal long-lived production env file.

   ```sh
   docker compose --env-file .env.production.bootstrap -f docker-compose.production.yml --profile bootstrap run --rm bootstrap
   ```

   The CLI prompts for username/full name and two no-echo password entries. On success it writes one admin and a NULL-actor system audit event transactionally. Immediately rotate the DB role password, remove the temporary secret/env file, and verify no bootstrap secret is mounted in the normal API service. A second bootstrap refuses without mutation.

## Build, start, and inspect

Set `APP_BUILD_SHA`, `PUBLIC_BUILD_ID`, and `ADMIN_BUILD_ID` to the release/source revisions; set `VITE_CARTO_PUBLIC_KEY` to a synthetic key while rehearsing. The key is deliberately present only in the public static image. The independently built admin image receives no CARTO key. Run production static build/proxy tests in CI or a local Docker environment with synthetic responses; do not call the live tile or geocoder endpoints for validation.

After TLS, DNS/firewall, provider/legal/account, secret, DB, backup/restore, and operational gates are independently closed, start the API and edge:

```sh
docker compose --env-file .env.production -f docker-compose.production.yml up -d backend nginx
docker compose --env-file .env.production -f docker-compose.production.yml ps
```

The service health check proves only that `/api/health` can query the database. Nginx serves only the exact public/admin roots; public-host admin APIs, admin-host public APIs, unknown API paths, and unknown Hosts are denied. The public address suggestion is the only production Geoapify use. The API has a fixed EU endpoint and no fallback provider. CARTO is public-browser traffic and its key is visible by design.

This repository does not define a production rollback procedure or a safe down-migration. Do not treat image rollback as database rollback. Backups, restore drills, one-year cleanup, measured RPO 24h/RTO 4h, Ubuntu 24.04 2-vCPU/4-GB resource validation, host monitoring/alerts, secret rotation ownership, and release/rollback operations remain separate checkpoints.

## Development, held integration, and scope

The root `docker-compose.yml` is **development only**; it publishes Postgres, Express, and Vite dev ports. The production topology is defined separately in `docker-compose.production.yml`. The normal HTTP startup verifies the migration ledger and starts the import worker but does not run migrations, seed an administrator, or invoke inventory geocoding. Use the controlled migration service before the API.

AUSEMIO remains **ON HOLD**: no real `/api/reports/send`, no POST to AUSEMIO, no citizen-report persistence, and no local test sink in production. Product scope remains AUSEMIO service `2` / VO; service `16` / CSS remains out of scope. Production is not ready merely because this foundation builds: provider/account/privacy/legal approval and the deferred operations/resource work above remain gates.

## Database operations Phase A status

**Implemented in this phase:** dedicated `lighting_backup` and `lighting_retention` login roles; separate fail-on-collision provisioning; explicit current-object grants; a read-only retention eligibility inspection boundary (`lighting_retention` has no DELETE privilege in Phase A); no maintenance role memberships/default privileges; HTTP/Compose credential boundaries; and disposable PostgreSQL 16/PostGIS role and effective-privilege integration evidence.

**Not implemented here:** backup execution or wrapper, encryption/key custody, off-host storage/upload, manifest creation, backup timer, restore tooling/drill, RPO/RTO evidence, destructive retention scheduling/algorithm or DB-side destructive eligibility enforcement. Phase F will define that enforcement only after evidence and independent audit; it must cover the one-year cutoff, terminal batch status and `completed_at`, pending-row protection, retained audit references, expired refresh sessions, import cascade/cardinality safety, and an approved table/category allowlist. `integration_logs` retention remains OWNER DECISION REQUIRED and has no DELETE grant. Owner/infrastructure gates from the canonical recovery plan remain open. The manifest-ID convention and target-class snapshot maximum remain documented P2 follow-ups for the future backup implementation; the snapshot maximum must be measured for the approved target class before production use.
