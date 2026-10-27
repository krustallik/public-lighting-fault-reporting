# Production release and deployment boundary

**Runtime status at this checkpoint:** deployment workflow and fail-closed host scripts are being prepared. This document is not evidence that the application is deployed or that provider accounts work.

## Production behavior

- Public site: `https://mapa-svietidiel.sk`; admin site: `https://panel.mapa-svietidiel.sk`.
- Geoapify report-time address suggestions and CARTO basemap are real provider paths. `NOMINATIM_AUTO_GEOCODE=false` remains explicit.
- `REPORT_SUBMISSION_MODE=local-persistence` is the intended hosted mode and requires `EMAIL_VERIFICATION_ENABLED=true`. A successful submission is recorded only as permitted fault metadata in PostgreSQL; the API does not contact AUSEMIO and does not claim that the city accepted the report.
- `REPORT_SUBMISSION_MODE=disabled` is the safe Compose default. `LOCAL_TEST_SUBMIT_ENABLED=false` is required in production.
- `RESEND_API_KEY_FILE`, Geoapify key, JWT secret and database credentials are host-mounted files. CARTO's browser key is public by design and appears in the public bundle.
- Automatic AUSEMIO delivery, service 16/CSS, Nominatim automatic inventory geocoding and external report submission are outside this release.

## Release gate

The protected `master` branch requires the six strict status checks: `frontend`, `backend`, `sqlfluff-report`, `dependency-audit-report`, `process-egress-research`, and `browser-e2e`. Administrator enforcement is enabled, force pushes and branch deletion are disabled, and approving reviews are not required. The owner explicitly removed the independent-review gate for this deployment. The release workflow independently rechecks successful CI for the exact current `master` SHA before any VPS rollout.

`.github/workflows/deploy-production.yml` reacts only to a completed successful `CI` run caused by a push to `master`. It rechecks that the CI SHA is still the exact master HEAD and that all six jobs succeeded. The deployment uses a dedicated forced-command SSH key, pinned host key and a single restricted sudo entry. A failed connectivity or host preflight ends before an application rollout.

The host fetches the exact public master commit and builds its four production images sequentially using the checked-in Dockerfiles. This avoids storing a registry pull credential on the VPS and fits its reviewed 2-vCPU/approximately-4-GB class. It requires outbound access to GitHub, package registries and base-image registries at build time.

## Host gates before the first release

The first release is intentionally not self-bootstrapping. Before it can pass, an operator must create `/etc/plfr-production/production.env` and its file-backed secrets, issue a trusted certificate for the three selected hostnames, create the new approved PostgreSQL volume, provision the restricted DB roles, apply the canonical schema once through the controlled migration profile, grant runtime permissions, and create the first administrator. None of these database initialization operations run from a merge-triggered workflow.

The merge-triggered workflow refuses to deploy unless the approved volume already exists and its DB container is healthy, all production flags/secret files are present, and the TLS certificate is valid for `mapa-svietidiel.sk`, `www.mapa-svietidiel.sk`, and `panel.mapa-svietidiel.sk`. It runs `migration-check`, which verifies the release's migration ledger with the restricted migration role and does not execute SQL migrations. A schema mismatch blocks deployment for explicit review.

The workflow starts only `backend`, `public-app`, `admin-app`, and `nginx` with `--no-deps`; it never starts/recreates the database as part of a rollout. It waits for application readiness and verifies same-host HTTPS health and route responses. On failure it restores the previous image SHA if available and leaves the database, named volume and previous release checkout untouched. It does not prune images, remove volumes, run down-migrations, or reset/seed data.

Certbot renewal hooks stop only this application's edge while standalone HTTP-01 renewal needs port 80, validate/copy the renewed certificate atomically, then restart the same recorded release. An interrupted renewal is a stop condition requiring operator inspection.

## Known prerequisites and limits

- Exact provider account/key validity is not established by configuration presence. Real CARTO, Geoapify and Resend checks require the deployed browser flow; the workflow itself sends no provider requests.
- DNS for `admin.mapa-svietidiel.sk` points elsewhere and is intentionally not used or changed. `panel.mapa-svietidiel.sk` is the selected admin host.
- The initial production DB creation, grants, migration, and admin bootstrap are explicit one-time operator actions. Future schema migrations require a separately reviewed controlled release; the routine deployment never applies them.
- Image rollback is not database rollback. A schema mismatch fails before rollout. Off-host backup, restore drill, monitoring/alerting and a measured recovery objective remain later operational work; do not treat image rollback as recovery from host or storage loss.
- Automated browser QA after deployment still needs a real public-browser walkthrough. CI, container health and local smoke checks alone are not production validation.
