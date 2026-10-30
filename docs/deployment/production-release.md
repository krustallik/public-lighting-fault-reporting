# Production release and deployment boundary

**Runtime status at this checkpoint:** deployment and renewal code are prepared in PR #39. No deployment, production database write, DNS API call, Websupport credential use, Resend message, Geoapify request, CARTO request, or AUSEMIO request was performed by this change.

## Production behavior

- Public site: `https://mapa-svietidiel.sk`; admin site: `https://panel.mapa-svietidiel.sk`.
- Geoapify report-time address suggestions, CARTO basemap, and Resend OTP are intended real-provider paths. `NOMINATIM_AUTO_GEOCODE=false` remains explicit.
- `REPORT_SUBMISSION_MODE=local-persistence` records only the approved service-2 fault metadata in PostgreSQL. A success means locally recorded; AUSEMIO is not called and the city has not accepted the report.
- `REPORT_SUBMISSION_MODE=disabled` is the safe Compose default. Production requires `LOCAL_TEST_SUBMIT_ENABLED=false`.
- Contact data, description, attachment bytes, and user identifiers are excluded from permanent fault history. Opaque attempt receipts are usable for retry resolution for 30 days and are not citizen identifiers; physical removal is batched and can lag during downtime or backlog. The browser pins a pending retry to its first attempt time and blocks it after that same 30-day receipt window; corrupt or incomplete saved retry data also fails closed instead of rebuilding a potentially different report.
- Service 16/CSS, AUSEMIO delivery, and automatic Nominatim inventory geocoding remain out of scope.

## Release gate

The authoritative owner sequence is:

`Coding → tests/internal review → independent Code Audit PASS → master update → exact-SHA CI → authorized deployment → runtime QA`.

Green CI does not replace independent Code Audit. The deployment workflow cannot establish that a human independent audit occurred; that is a required owner gate before updating `master`. Do not deploy a PR head.

The protected `master` branch requires the six strict status checks: `frontend`, `backend`, `sqlfluff-report`, `dependency-audit-report`, `process-egress-research`, and `browser-e2e`. The `Production deployment` workflow runs only for a completed successful `CI` workflow triggered by a push to `master`. It independently checks the exact current master SHA, workflow ID `373985460`, canonical path `.github/workflows/ci.yml`, push event, `master` branch, repository identity, and every completed successful job. Host-side verification repeats those checks before rollout.

Deployment uses the dedicated forced-command SSH account, pinned SSH host key, a restricted sudo entry, and the `production` GitHub environment. Build and rollout use the exact source SHA. Each successful CI run has its own GitHub concurrency group, preventing a late older event from replacing the latest pending release. The checkout lock waits at most ten minutes and is released before deployment; the release lock then waits at most one hour. The 195-minute deploy-job cap leaves at least two hours for image build, checks, rollout, and recovery after both maximum lock waits. The host revalidates exact master before rollout. Certificate installation and edge restart use the same release lock. The edge restart helper reads the authoritative `current-release`, verifies the exact local edge image label, and runs Compose with `--no-build --pull never`; an unknown marker or missing/mismatched image stops the operation.

The host builds the four production images sequentially from the checked-in Dockerfiles. Before changing application containers, it verifies the already-existing approved PostgreSQL volume and healthy DB container and checks the current packaged migration ledger without applying migrations. If a prior release exists, its packaged migration check also runs read-only against the current ledger. When that old image is schema-compatible, a failed application rollout restores its SHA. If it is incompatible (for example, its packaged chain predates an applied migration), rollback is disabled: a failed rollout stops the application services and preserves the new release files and database for forward recovery. Neither path runs down-migrations, resets data, removes volumes, or prunes images. Image rollback is not database or host recovery.

## TLS renewal implementation and external gate

The current VPS Certbot lineage was observed as manual DNS-01, while the prior hooks assumed standalone HTTP-01. That configuration did not prove automatic renewal. The repository now prepares automated DNS-01 through the pinned Lego `5.5.2` Websupport provider. The provider requires `WEBSUPPORT_API_KEY` and `WEBSUPPORT_SECRET` and supports their `_FILE` forms, bounded API timeouts, DNS propagation polling, and TXT TTL settings. See the [Lego Websupport provider documentation](https://go-acme.github.io/lego/dns/websupport/) and [Websupport REST API v2 documentation](https://rest.websupport.sk/v2/docs).

Install the reviewed DNS client manually on the deployment host only after the owner approves host preparation. Download the pinned [Lego v5.5.2 Linux AMD64 release](https://github.com/go-acme/lego/releases/tag/v5.5.2), verify `lego_v5.5.2_linux_amd64.tar.gz` against SHA-256 `2a35505089e7772c92e1e9ac144df91151ef2eca8568630db0ff91fca06d9bef` before extraction, install its `lego` binary as root-owned `/usr/local/bin/lego` (mode `0755`), then verify `/usr/local/bin/lego --version` reports `5.5.2`. The host installer intentionally refuses to proceed if this pinned binary is absent or has another version. Do not install or invoke Lego from GitHub Actions.

The prepared service uses only the Websupport DNS credentials stored on the host at:

- `/etc/plfr-production/secrets/websupport-api-key`
- `/etc/plfr-production/secrets/websupport-secret`

Both files must be root-owned, non-empty, non-symlink files with no group/other permissions. DNS credentials never belong in GitHub Actions. The Websupport API key must be scoped to `mapa-svietidiel.sk` and the narrowest DNS-record permissions Websupport offers. Before activation, the owner must verify in Websupport's account UI or support documentation that the credential cannot alter A, MX, SPF, DKIM, or unrelated zones; if that scope cannot be established, stop and do not activate renewal.

`install-deployment-host.sh` creates an empty root-owned mode-0700 production ACME state directory, installs the reviewed scripts, writes `/etc/plfr-production/acme.env` with no credentials and `ACME_RENEWAL_ENABLED=false`, and installs the systemd service/timer while leaving the timer disabled. The owner must set `ACME_ACCOUNT_EMAIL` in that protected file and create the two referenced root-owned mode-0600 Websupport credential files. The staging script reads that file itself; callers must not export secrets. Its exact opt-in is `sudo env PLFR_APPROVE_ACME_STAGING_DNS_CHALLENGE=yes /opt/plfr-production/control/check-websupport-acme-staging.sh`. It issues a staging certificate for the apex, `www`, and `panel` names, waits up to 180 seconds for TXT propagation, and checks SANs, expiry, and key matching without installing that staging certificate. No such challenge or API call has been run here.

After staging succeeds, the owner can explicitly approve the one-time production issuance with `sudo env PLFR_APPROVE_PRODUCTION_ACME_ISSUANCE=yes /opt/plfr-production/control/initialize-production-certificate.sh`. It refuses a non-empty ACME lineage, requests the three configured SANs, validates the certificate/key pair, and passes them to the same locked TLS installation hook; it does not deploy the application. If issuance or installation fails, the lineage is retained for inspection and must not be deleted blindly. Only after verifying the installed trusted certificate should the owner set `ACME_RENEWAL_ENABLED=true` in `/etc/plfr-production/acme.env` and enable the timer. The renewal script checks the existing root-owned mode-0700 lineage daily, renews when within 30 days of expiry, validates the complete SAN set and key pair, and installs a versioned certificate/key directory. Nginx reads the pair through the atomic `tls/current` symlink. The old version remains available for rollback. The shared release lock serializes pointer replacement, exact-SHA edge recreation, deployment, and rollback; failed health checks restore the old pointer and retry the same exact edge. If restoration or health verification fails, stop for operator recovery. The TLS hook additionally checks both that inherited descriptor 9 resolves to the configured lock path and that the descriptor can non-blockingly confirm the held lock.

Incoming certificate pairs must have at least seven days of remaining validity. During renewal, the current pair is checked for the expected hostnames and matching key but its remaining lifetime does not block replacement; this lets a valid renewal recover an expiring certificate. If the new edge fails its health checks, rollback restores the exact prior pair, which can still be near expiry.

Production issuance and renewal acquire the shared release lock before the ACME operation and retain it through certificate installation and HTTPS health checks. The install hook validates that its caller passed the same locked descriptor. A separate ACME-state lock also serializes staging, issuance, and renewal so parallel challenges do not race over Lego state or DNS records. A wrapper-level CI test runs the real renewal and TLS installation scripts with fake Lego, Docker, and curl executables, and starts the real deployment wrapper as a competing process; all paths and credentials are temporary synthetic fixtures, and fake Lego makes no network calls.

The existing Certbot timer/lineage must be read-only inspected before the switch. Do not disable Certbot's timer until the owner confirms it serves no other lineage or application; after a successful Lego staging check and production activation, prevent two renewal systems from competing for this domain. Port 80 availability is not assumed and HTTP-01 is not used.

**Renewal status is not yet proven.** A future PASS requires an actual authorized staging challenge, successful issuance, installed systemd timer status, a successful renewal run, trusted-chain/SAN/key verification, Nginx health checks after installation, and evidence that the HTTPS sites remained available. Current code and unit tests alone do not prove provider credentials or renewal.

## First-release prerequisites

Before the first production release, an operator must:

1. Confirm public DNS for the three HTTPS names and trusted TLS readiness. Do not change unrelated DNS records.
2. Prepare `/etc/plfr-production/production.env` and protected file-backed secrets for DB administrator/runtime/migration/bootstrap, JWT, Geoapify, and Resend; configure the public CARTO key and sender address. Never put application, database, or provider credentials in the repository or frontend build arguments. The only intended GitHub Actions secret is the restricted `VPS_PRODUCTION_DEPLOY_KEY`, used solely for forced-command SSH; Websupport DNS credentials and application secrets remain on the VPS.
3. Establish `TLS_DIRECTORY=/etc/plfr-production/tls`, place the verified certificate pair there, and allow the controlled deployment to migrate that legacy pair into versioned `tls/releases/<fingerprint>` storage. Nginx's new configuration reads `tls/current`.
4. Create the approved PostgreSQL volume and database through the controlled initial provisioning procedure; provision the restricted roles; have the DBA install required extensions (`pgcrypto`, PostGIS, and `pg_trgm`) in the application database before running the canonical migration chain; apply the migrations once; apply `database/production/grant-application-roles.sql` including the new receipt-table permissions; and bootstrap the first admin. These are explicit owner-approved database actions, never performed by merge-triggered deployment. The restricted migration role must not receive database-level `CREATE` just to install an extension.
5. Complete and verify an encrypted backup plus restore drill before retaining real citizen reports. The backup path and recovery procedure must be available to the operator before real use; image rollback does not recover lost database or host data.
6. Confirm Geoapify account/key and data-handling approval, CARTO key domain restrictions, and Resend verified sender/domain and delivery prerequisites. Current CI uses synthetic values and makes no provider request.

The workflow refuses rollout unless the approved database volume already exists and its DB container is healthy, the production flags and secret files are valid, TLS covers `mapa-svietidiel.sk`, `www.mapa-svietidiel.sk`, and `panel.mapa-svietidiel.sk`, and the exact packaged migration ledger is current. It never starts/recreates PostgreSQL as part of rollout and never applies migrations.

## Verification limits and recovery

- Provider-account validity, DNS API permissions, public routing, external network reachability, and real browser delivery are not established by repository tests.
- Geoapify, CARTO, Resend, and AUSEMIO were not contacted as part of this PR. AUSEMIO remains disabled.
- Before first live reports, run a controlled public HTTPS walkthrough for map/tile loading, Geoapify address suggestion, Resend OTP, metadata persistence, recurrence, and admin auth/CRUD/import/export. Verify browser network requests and do not describe local persistence as municipal acceptance.
- Initial DB creation, grants, schema application, and admin bootstrap are separate controlled actions. Later schema changes require an independently audited release and explicitly authorized migration procedure.
- Off-host backup, restore drill, recovery objective, monitoring, and alerting are operational prerequisites for real city use and remain outside this code-only change.
