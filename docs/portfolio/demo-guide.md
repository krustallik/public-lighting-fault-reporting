# Local portfolio demo

This optional recipe runs the existing development app in an isolated Compose project and creates only synthetic inventory/admin rows. It does not enable AUSEMIO, Resend, Geoapify, CARTO, or report submission. The only external browser traffic is ordinary GET requests for OpenStreetMap tiles when the public map is viewed.

## Prerequisites

- Docker Compose v2.24+ (the overlay uses `!override`).
- Node.js 20+ and the backend package dependencies (`cd backend; npm ci`).
- No use of production or owner inventory databases.
- Check that the dedicated container names, loopback ports `15432`, `18000`, `18097`, `18098`, and volume `plfr-portfolio-demo-pgdata` are unused before starting. If any are occupied, stop and choose another isolated overlay rather than reusing or deleting them.

## Create a private demo environment file

From PowerShell at the repository root:

```powershell
$envFile = Join-Path $env:TEMP ("plfr-portfolio-demo-" + [guid]::NewGuid().ToString('N') + '.env')
./scripts/portfolio-demo/create-env.ps1 -OutputPath $envFile
```

The script writes a new file outside the repository with random local-only database/JWT/admin values and provider flags disabled. It prints only the path. Keep the file private and remove it when finished.

## Start the isolated stack

```powershell
$compose = @('-p', 'plfr-portfolio-demo', '--env-file', $envFile, '-f', 'docker-compose.yml', '-f', 'scripts/portfolio-demo/compose.override.yml')
docker compose @compose up -d --wait db
docker compose @compose exec -T db sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"'
docker compose @compose up --build -d
```

`pg_trgm` is installed only in this new local demo database because migration `0006` requires it. The application does not create this extension from its restricted runtime/migration path.

Seed the empty demo database and open the apps:

```powershell
node "--env-file=$envFile" scripts/portfolio-demo/seed-synthetic.mjs
```

- Public map: <http://localhost:18097/map>
- Admin login: <http://localhost:18098/panel-svietidla/login>
- API health: <http://localhost:18000/api/health>

The seeded admin username is `portfolio-demo`. To read the generated password locally without printing the rest of the environment file:

```powershell
Select-String -Path $envFile -Pattern '^ADMIN_INITIAL_PASSWORD='
```

The seed refuses to connect unless the explicit opt-in is set, the DB host is loopback, the database name ends in `_demo_dev`, the password is strong, and the application's business tables are empty. It never truncates or updates existing rows.

## Stop only this demo

```powershell
docker compose @compose down
```

This stops containers in the named demo project and leaves its uniquely named demo volume intact. Do not use global `docker system prune`, `docker volume prune`, or commands against other Compose projects. Remove the temporary environment file after the stack is stopped. If you later decide to remove the demo volume, verify its exact name and that this dedicated demo data is disposable first.

## Screenshots in this repository

The README screenshots were captured from a loopback-only disposable Compose run. The inventory image contains generated `DEMO-*` records; the map uses OpenStreetMap development tiles; and the form captures contain only synthetic text, placeholder contact details, and a browser-local sample attachment. No form was submitted. The public map and report form use the app's English locale. Admin screenshot labels were translated in-browser for presentation only; the admin app itself currently uses Slovak labels. These images are presentation captures, not live-provider or production-runtime evidence.
