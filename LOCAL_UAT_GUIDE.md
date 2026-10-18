# Local user acceptance testing

This guide starts a loopback-only, synthetic local environment for owner review of the public and admin applications. It uses the real application API, OTP persistence/cryptography, admin database operations, migrations, imports, audit history, and local simulated report sink. Email and report-address providers are fake. No AUSEMIO or live Resend/Geoapify/CARTO request is made.

## Scope and boundaries

- Public reporting is the existing VO/service 2 flow. `EMAIL_VERIFICATION_ENABLED=true` is set only for this local run so the owner can exercise the OTP flow.
- A local-only `LOCAL_UAT_MODE=true` permits OTP startup without Resend credentials. The UAT server explicitly injects an in-memory email provider. The ordinary provider-backed app entrypoint rejects this flag before loading its provider-backed modules.
- OTP codes are generated and verified by the existing backend service against the disposable PostgreSQL database. Only the fake email delivery is in memory. The fake inbox is bound to `127.0.0.1:5001`, retains only the latest message, and is cleared when the backend stops.
- Address suggestions use the real Geoapify response adapter with a fake in-memory transport. The transport never calls `fetch` or opens a network connection. The normal `GEOAPIFY_ENABLED` runtime setting stays `false`.
- `NOMINATIM_AUTO_GEOCODE=false`. The local map uses generated, labelled synthetic tiles served by the public Vite dev server on loopback. These tiles do not represent a real street map and are not CARTO tiles.
- The final reporting action reaches the existing local simulated sink. It is not stored as a citizen report and never calls AUSEMIO. Uploaded content is discarded by the metadata-only sink after it reports the received file count.
- Admin inventory, import, export, and audit actions use the disposable database and persist across normal stop/start. The database contains the repository's synthetic Košice lighting inventory only.

## Prerequisites

- Windows PowerShell, Node.js 22 or compatible, npm, and a running Docker Desktop engine.
- Install dependencies once if the repository does not already have them:

  ```powershell
  Push-Location backend; npm ci; Pop-Location
  Push-Location frontend; npm ci; Pop-Location
  ```

- Ports `5000`, `5001`, `5173`, `5174`, and `5433` must be free. The existing service on `5432` is never used or changed.
- The dedicated Docker bridge disables IP masquerading, and publishes only PostgreSQL on `127.0.0.1:5433`. The project does not use the general development Compose file. No containerized application/provider is run in this project.
- First start creates ignored local state under `.local-uat/`, generates random local database/JWT/admin credentials, resets each state item to a DACL granting only the current Windows account, runs the guarded development seed, and starts the application servers bound to `127.0.0.1`. Later starts reapply and verify that ACL before reading credentials, recreate the log and empty frontend env directories when missing, and stop if the tree contains a symbolic link, reparse point, or dotenv file.
- The backend process and its migration/seed commands run from the private UAT state directory so repository `.env` files are not loaded. UAT child processes clear every inherited `*_FILE`, direct database/backup/identity/provider credential, JWT/admin bootstrap secret, `NODE_OPTIONS`, `NODE_PATH`, and `VITE_*` value before applying the small public/admin allowlists. Vite reads environment files only from the protected empty `.local-uat/frontend-env` directory. Resend and AUSEMIO credentials remain blank and the fake providers are injected explicitly; the UAT backend also case-insensitively checks its loopback-only environment before dynamically importing application configuration or database modules. Docker actions reject host/context overrides, verify a local Docker Desktop named-pipe endpoint, pin that context for each command, and supply Compose only the UAT database interpolation values.
- If database files exist but the private runtime settings are missing, the script stops without recreating credentials or resetting the database. Keep `.local-uat/` together while using this environment.

## Start, inspect, stop, and reset

Run from the repository root:

```powershell
.\scripts\local-uat\start.ps1
.\scripts\local-uat\status.ps1
.\scripts\local-uat\stop.ps1
```

Start runs migrations and the guarded synthetic seed only for a new database. Subsequent starts apply pending migrations and preserve the existing UAT data. Stop halts only the process IDs recorded by this UAT launcher and the Compose `plfr-local-uat` database container. It preserves the database volume.

To restore the synthetic inventory and clear UAT-only imports, admin activity, audit records, refresh sessions, OTP challenges, and OTP rate limits, stop the app and run:

```powershell
.\scripts\local-uat\reset.ps1 -ConfirmDisposableUatReset
```

The reset guard checks the dedicated Compose project and the exact database name `lighting_faults_local_uat_dev`, user `plfr_uat`, host `127.0.0.1`, and port `5433`. It does not remove the volume or act on any other database.

## Local URLs and administrator credentials

| Purpose | URL |
| --- | --- |
| Public map and report flow | <http://127.0.0.1:5173/map> |
| Admin login | <http://127.0.0.1:5174/panel-svietidla/login> |
| Fake email inbox | <http://127.0.0.1:5001/> |
| Local UAT status | <http://127.0.0.1:5000/api/dev/local-uat/status> |

Open `.local-uat/private/admin-credentials.txt` for the generated username/password. The file is ignored by Git and its ACL is restricted to the current Windows account. The seeded username is `admin`. Public reporting is anonymous.

Use an address such as `uat@example.test` in the public flow. After selecting **Poslať kód / Send code**, switch to the fake inbox, refresh if needed, and enter the displayed code. The inbox shows no message until the app requests one. A successful OTP verification advances to the existing review step; the final public action still displays `LOCAL TEST / SIMULATED`.

## Manual acceptance checklist

### Public flow

1. Load the map and confirm synthetic inventory markers, generated synthetic tiles, map attribution, language switch, and custom-location selection.
2. Select an inventory light or a custom point and open the report form. Confirm the selected target is retained.
3. Complete the service-2 report fields, choose a fault code (including Q99 if desired), enter a synthetic phone number, and continue.
4. Enter `uat@example.test`, give consent, request the OTP, read it from the fake inbox, verify it, go Back, and use the verified Continue action to return to review.
5. Generate attachment fixtures with `./scripts/local-uat/create-test-files.ps1`, attach `.local-uat/private/test-files/valid-synthetic-attachment.txt`, submit, and confirm the success page explicitly says local simulation and does not show an external issue reference. The local `VITE_API_URL` is an absolute loopback URL because the simulated submission transport validates that boundary before it sends to its local sink.
6. For the upload error, attach `oversize-synthetic-attachment.bin`; it is one byte above the 10 MiB local test sink limit. Confirm it is rejected without simulated success, remove it, and retry with the valid fixture.
7. In browser developer tools, test a narrow viewport (for example 390×844) and keyboard-only navigation through the map controls, report fields, OTP controls, file picker, and review action.

### Address-suggestion scenarios

The fake scenario is changed locally; it does not contact Geoapify. Select a custom point, enter the report fields, then submit to exercise the address suggestion and local sink. A successful suggestion is added as optional location detail; provider errors leave manual reporting available.

```powershell
.\scripts\local-uat\set-address-scenario.ps1 -Scenario success
.\scripts\local-uat\set-address-scenario.ps1 -Scenario no-result
.\scripts\local-uat\set-address-scenario.ps1 -Scenario unavailable
.\scripts\local-uat\set-address-scenario.ps1 -Scenario timeout
.\scripts\local-uat\set-address-scenario.ps1 -Scenario rate-limited
.\scripts\local-uat\set-address-scenario.ps1 -Scenario budget-exhausted
.\scripts\local-uat\set-address-scenario.ps1 -Scenario outside-area
```

`outside-area` is a local-only classifier override to make that UI state deterministic. The default scenario still uses the actual Košice service-area classifier and coordinate validation.

### Admin flow

1. Sign in using the private handoff file. Confirm the dashboard reflects the seeded inventory.
2. Create a synthetic test light, open its detail, edit it, and delete it. Confirm the list and detail state update after each action.
3. Preview `database/import-examples/street-lights.example.csv`, inspect validation and duplicate/update options, confirm import, and verify the queued batch reaches `completed`. The row is searchable in inventory and removable afterward. Import history is visible in the admin logs page.
4. Preview `database/import-examples/street-lights.invalid-local-uat.csv`. Confirm the invalid-coordinate and missing-inventory rows are rejected in preview, then leave the batch unconfirmed.
5. Export the inventory and confirm the downloaded file contains the current synthetic records. Reset when the acceptance run is complete if a clean synthetic inventory is wanted.

The initial local UAT browser run verified map rendering and custom-location reporting, locality suggestions, Q99 conditional text, required-phone validation, file attachment display, wrong and correct OTP handling, Back/Continue after verification, and the final local simulated result. Admin browser checks verified invalid login feedback, authenticated inventory list/pagination/search/status filtering, required-field validation, create/edit/delete, CSV import preview and completion, and import history. A manual export download did not produce a conclusive browser result in this session; the export buttons and API/regression coverage remain available for a later owner check. These checks use synthetic data only and do not establish production provider or basemap behavior.

## Resend activation prerequisites (future owner-approved step)

Live delivery is not part of local UAT. Keep `EMAIL_VERIFICATION_ENABLED=false` in ordinary and production environments until a separate owner approval is recorded.

When activation is approved, the backend uses these exact settings:

```dotenv
EMAIL_VERIFICATION_ENABLED=true
RESEND_API_KEY=<server-side secret>
RESEND_FROM_EMAIL=<verified sender address>
```

Store `RESEND_API_KEY` only in the backend secret store. Do not put it in a `VITE_*` variable or client bundle. Before activation, the owner must control an owned sending domain, add the exact DNS records shown by Resend for that domain, wait for Resend's verification state, choose a sender on the verified domain, set the two backend values, and agree on recipient/test restrictions and the operational sending limit. Resend documents that a verified owned domain is required and recommends a separate sending subdomain for reputation separation: [Verified Domains](https://resend.com/docs/dashboard/domains/introduction). A successful API response is evidence of API acceptance, not proof that the recipient's inbox received the code; verify real delivery only after the activation gate is approved using a designated test recipient and the provider's delivery evidence. Current endpoint details are in [Send Email](https://resend.com/docs/api-reference/emails/send-email).

## Geoapify and map-provider onboarding (future owner-approved step)

No key is needed or used in local UAT. The production report-time reverse-geocoding integration expects:

```dotenv
GEOAPIFY_ENABLED=true
GEOAPIFY_BASE_URL=https://api-eu.geoapify.com
GEOAPIFY_API_KEY=<server-side secret>
GEOAPIFY_DAILY_BUDGET=2700
NOMINATIM_AUTO_GEOCODE=false
```

The backend requires an explicit server-side key when `GEOAPIFY_ENABLED=true`, applies its own request/rate/budget bounds, and validates report coordinates against the Košice service area. As checked on 2026-10-18, Geoapify's published Free plan lists 3,000 credits/day and up to 5 requests/second, and its API docs count one reverse-geocoding request as one credit. Confirm the account's current plan, terms, quota, attribution, and expected monthly volume before enabling the key; the application budget is not provider approval. Sources: [Geoapify pricing](https://www.geoapify.com/pricing/) and [Reverse Geocoding API](https://apidocs.geoapify.com/docs/geocoding/reverse-geocoding/).

The production public build currently requires the CARTO tile provider, explicit approval, and a public build-time key: `VITE_MAP_TILE_PROVIDER=carto`, `VITE_CARTO_TILES_APPROVED=true`, and `VITE_CARTO_PUBLIC_KEY`. This key is a browser-visible map credential, not a server secret. No key is set here. Before the production build, the owner must obtain/approve a key, classify the project against CARTO's current non-commercial/commercial plan and terms, configure any available origin restrictions, and verify required attribution. CARTO currently publishes separate non-commercial and commercial request tiers; check the live key page and terms before committing to a plan: [CARTO Basemaps key and plans](https://www.carto.com/basemaps/apikey/).

## External integration readiness matrix (checked 2026-10-18)

| Dependency | Local UAT evidence | Production prerequisite / current status |
| --- | --- | --- |
| PostgreSQL/PostGIS | Dedicated disposable PostGIS 16 container, loopback-only port 5433; the current synthetic inventory and OTP persistence are exercised locally. | Production host, database ownership, credentials, backup and restore evidence are unknown here; VPS discovery/deployment approval is a separate stage. |
| Resend email | Fake in-memory delivery and local inbox only. No Resend request or real email was sent. | Owner-controlled verified sending domain and DNS records, backend-only API key, sender address, recipient policy and explicit activation approval are required. Keep `EMAIL_VERIFICATION_ENABLED=false` until those gates are complete. See [domain setup](https://resend.com/docs/dashboard/domains/introduction), [send API](https://resend.com/docs/api-reference/emails/send-email), and [pricing](https://resend.com/pricing?product=transactional); verify the account's current limits before launch. |
| Geoapify report-time address suggestions | Existing response adapter is exercised with an in-memory fake transport; status reports zero transport requests. No Geoapify key is present. | Owner-approved account/project and server-side API key, a reviewed daily budget, and review of the user notice/privacy implications of sending report coordinates for an address suggestion. The configured key must remain server-side. Check [account/project setup](https://myprojects.geoapify.com/), [API docs](https://apidocs.geoapify.com/docs/geocoding/reverse-geocoding/), and current [plan limits](https://www.geoapify.com/pricing/) before activation. |
| CARTO basemap tiles | Generated synthetic tiles only; not CARTO and no public map key is used. | Production public build requires the explicit provider/approval settings and a browser-visible public key described above, an owner-approved plan, origin restrictions where available, and required attribution. Check [key and plan details](https://www.carto.com/basemaps/apikey/) before issuing a production build key. |
| Nominatim inventory geocoding | Automatic geocoding remains disabled. | `NOMINATIM_AUTO_GEOCODE=false` is the confirmed product decision; do not enable it as part of deployment. |
| AUSEMIO VO/service 2 submission | Local test sink only; it returns a labelled simulation and no citizen report is stored. No external request is made. | On hold. A verified external server contract, credentials, owner approval and a separately reviewed activation package are still required. This local UAT does not prove acceptance by AUSEMIO. |

No production VPS, provider account, DNS zone, production database, or production credential was inspected in this local UAT. Provider availability, terms, quotas, account ownership, delivery, and external acceptance therefore remain unverified. The Geoapify key is a server credential; the CARTO key is necessarily public in the browser build and must be restricted and budgeted accordingly. No live provider activation is authorized by this guide.

## AUSEMIO boundary

The local form finishes at the repository's local test sink. The sink validates the VO/service-2 payload, consumes the OTP capability when enabled, returns a clearly labelled simulated result, and discards uploaded contents. There is no active AUSEMIO HTTP adapter or production report-send route in this UAT package. No AUSEMIO URL, credential, activation flag, or real submission is used.

## Known limits of the local demonstration

- Synthetic map tiles are a generic generated grid. They prove local map rendering and controls, not real basemap coverage or tile-provider billing/attribution.
- OTP is real application/database logic with fake in-memory delivery; it does not establish deliverability, spam placement, domain reputation, or real recipient access.
- The local simulated report sink does not persist a citizen report or prove AUSEMIO acceptance.
- Address scenarios exercise the existing response mapping/error handling with no provider traffic. They do not prove the account's external quota or production latency.
- Browser automation CI remains separately egress-isolated. The manual browser session needs only the loopback URLs listed above.
