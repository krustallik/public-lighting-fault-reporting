# Public lighting fault reporting

Thesis web application for reporting public lighting faults in Košice. Citizens use a public map to select a street light or location, fill a form compatible with DPMK/AUSEMIO, and send the report to the external system. The local app is a map and integration layer — not an authoritative report lifecycle system. Admins manage light points, import/export, and configuration.

## Technology stack

| Layer    | Stack |
| -------- | ----- |
| Frontend | React, Vite, TypeScript, React Router, Leaflet / OpenStreetMap, CSS Modules, React Hook Form + Zod |
| Backend  | Node.js, Express, TypeScript |
| Database | PostgreSQL (`schema.sql`, `seed.sql`) |
| Runtime  | Docker Compose (`frontend`, `backend`, `db`) |

## Project structure

```text
project/
├── .cursor/rules/     Cursor Project Rules (thesis & AI instructions)
├── frontend/          React + Vite + TypeScript (port 5173)
├── backend/           Node.js + Express + TypeScript API (port 5000)
├── database/          PostgreSQL schema and seed scripts
├── docker-compose.yml Docker orchestration
├── .env.example       Environment variable template
└── README.md
```

## Cursor project rules

Project-specific instructions for AI assistants and contributors are in **`.cursor/rules/`**:

| File             | Scope |
| ---------------- | ----- |
| `project.mdc`    | Global thesis scope (always applied) |
| `frontend.mdc`   | `frontend/**` — React, TypeScript, map, forms |
| `backend.mdc`    | `backend/**` — Express API, services |
| `database.mdc`   | `database/**` — PostgreSQL schema & data |
| `integration.mdc`| DPMK/AUSEMIO multipart integration |
| `security.mdc`   | Privacy, PII, admin separation |

## Quick start with Docker

1. Copy environment variables:

   ```bash
   cp .env.example .env
   ```

2. Build and start all services:

   ```bash
   docker compose up --build
   ```

### Development with auto-reload (recommended while coding)

Use a second Compose file that mounts your source into containers. Changes apply without rebuilding the image:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

| Service  | What reloads automatically                          |
| -------- | --------------------------------------------------- |
| Frontend | Vite HMR — React/CSS updates in the browser         |
| Backend  | `tsx watch` — restarts API on `.ts` file changes    |
| Database | Unchanged — restart only if you edit `schema.sql`   |

After adding npm packages, rebuild once:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Production-like run (compiled backend, no bind mounts):

```bash
docker compose up --build
```

3. Open the application:

   | Service    | URL                      |
   | ---------- | ------------------------ |
   | Frontend   | http://localhost:5173    |
   | Backend API| http://localhost:5000/api|
   | PostgreSQL | localhost:5432           |

   Health check: http://localhost:5000/api/health

## Ports

| Service    | Host port | Description              |
| ---------- | --------- | ------------------------ |
| `frontend` | 5173      | Vite dev server (React)  |
| `backend`  | 5000      | Express REST API         |
| `db`       | 5432      | PostgreSQL database      |

## Stop containers

Stop running containers (keep data):

```bash
docker compose down
```

Stop and remove volumes (reset database):

```bash
docker compose down -v
```

## Local development (without Docker)

**Database** — run PostgreSQL locally and apply scripts:

```bash
psql -U postgres -d lighting_faults -f database/schema.sql
psql -U postgres -d lighting_faults -f database/seed.sql
```

**Backend**

```bash
cd backend
cp ../.env.example .env   # adjust DB_HOST=localhost
npm install
npm run dev      # TypeScript via tsx watch
# or: npm run build && npm start
```

**Frontend**

```bash
cd frontend
npm install
npm run dev
```

Set `VITE_API_URL=http://localhost:5000/api` in `.env` at project root or `frontend/.env`.

## API endpoints

### Public

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/api/health` | Health check |
| GET | `/api/light-points` | List light points (map) |
| GET | `/api/light-points/:id` | Single light point |
| POST | `/api/reports/send` | Submit fault report (forwarded to AUSEMIO/DPMK) |
| GET | `/api/geocode/reverse` | Reverse geocode proxy |

### Admin (cookie auth — `credentials: 'include'`)

| Method | Path | Description |
| ------ | ---- | ----------- |
| POST | `/api/admin/auth/login` | Admin login (sets httpOnly cookies) |
| POST | `/api/admin/auth/refresh` | Refresh access token |
| POST | `/api/admin/auth/logout` | Logout and clear cookies |
| GET | `/api/admin/auth/me` | Current admin user |
| GET | `/api/admin/street-lights` | Paginated list (search, filter, sort) |
| GET | `/api/admin/street-lights/:id` | Street light detail |
| POST | `/api/admin/street-lights` | Create street light |
| PUT | `/api/admin/street-lights/:id` | Update street light |
| DELETE | `/api/admin/street-lights/:id` | Delete street light |
| POST | `/api/admin/street-lights/import/preview` | Import preview (multipart file) |
| POST | `/api/admin/street-lights/import/confirm` | Confirm import |
| GET | `/api/admin/street-lights/export?format=csv\|json\|geojson` | Export |
| GET | `/api/admin/integration/settings` | Integration config (read-only) |
| GET | `/api/admin/logs/activity` | Admin activity logs |
| GET | `/api/admin/logs/imports` | Import batch logs |
| GET | `/api/admin/logs/integration` | Integration logs (no citizen PII) |

## Admin authentication

- Access token (1 h) and refresh token (30 d) are stored in **httpOnly cookies** — not in `localStorage`.
- Refresh tokens are hashed in `admin_refresh_sessions`; plaintext tokens are never stored.
- Set `JWT_SECRET` and `ADMIN_INITIAL_PASSWORD` in `.env`.
- Default seed admin username: **`admin`**. On first backend start, `ADMIN_INITIAL_PASSWORD` replaces the placeholder hash in the database.

## Database migrations

- Fresh install: `schema.sql` + `seed.sql` run automatically via Docker (`docker-entrypoint-initdb.d`).
- Existing database: migrations run on **every backend start** (`backend/src/db/migrate.ts`), including `003_admin_auth_and_batches.sql`.
- Full reset: `docker compose down -v` then `docker compose up --build`.

## Required environment variables

| Variable | Description |
| -------- | ----------- |
| `JWT_SECRET` | Secret for signing JWT access/refresh tokens |
| `ADMIN_INITIAL_PASSWORD` | Password for seed user `admin` (first start only) |
| `CORS_ORIGIN` | Frontend origin (must match for cookies), e.g. `http://localhost:5173` |
| `VITE_API_URL` | API base URL for frontend, e.g. `http://localhost:5000/api` |
| `VITE_ADMIN_BASE_PATH` | Admin UI URL path (default `/panel-svietidla`; `/admin` redirects to map) |
| `DB_*` | PostgreSQL connection |
| `AUSEMIO_*` | DPMK/AUSEMIO integration |

See `.env.example` for the full list.

## Manual test checklist

1. Copy `.env.example` to `.env` and set `ADMIN_INITIAL_PASSWORD`.
2. Start stack: `docker compose up --build`.
3. Open http://localhost:5173/panel-svietidla/login — log in as `admin`.
4. Verify dashboard, street lights list, create/edit/delete a point.
5. Import: upload CSV/JSON, review preview, confirm (with/without update).
6. Export CSV/JSON/GeoJSON from street lights page.
7. View integration settings and technical logs (no citizen PII).
8. Log out — admin API returns 401; cookies cleared.
9. After access token expiry (or manual cookie delete): app auto-refreshes or redirects to login.

## Status

Implemented:

- Admin panel with cookie-based JWT auth
- Street light CRUD, import/export, technical logs
- AUSEMIO field mapping centralized in `backend/src/config/ausemioMapping.ts`
- No local report lifecycle, no permanent citizen PII in DB

Not in scope (by design):

- Local report statuses, technician assignment, repair workflow
- Long-term storage of citizen phone, email, report text, or photos
