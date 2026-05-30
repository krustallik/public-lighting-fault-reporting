# Public lighting fault reporting

Thesis web application skeleton for reporting faults in public street lighting. Citizens use a map and form to submit reports; the backend forwards them to an external system (AUSEMIO/DPMK) in a future phase. Admins manage light points.

## Project structure

```text
project/
├── .cursor/rules/     Cursor Project Rules (AI instructions)
├── frontend/          React + Vite + TypeScript (port 5173)
├── backend/           Node.js + Express API (port 5000)
├── database/          PostgreSQL schema and seed scripts
├── docker-compose.yml Docker orchestration
├── .env.example       Environment variable template
└── README.md
```

## AI / Cursor rules

Project-specific instructions for AI assistants live in **`.cursor/rules/`**:

| File            | Scope                                      |
| --------------- | ------------------------------------------ |
| `project.mdc`   | Global rules (always applied)              |
| `frontend.mdc`  | `frontend/**` — React, TypeScript, forms   |
| `backend.mdc`   | `backend/**` — Express API structure       |
| `database.mdc`  | `database/**` — PostgreSQL schema & seeds  |

## Quick start with Docker

1. Copy environment variables:

   ```bash
   cp .env.example .env
   ```

2. Build and start all services:

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
npm run dev
```

**Frontend**

```bash
cd frontend
npm install
npm run dev
```

Set `VITE_API_URL=http://localhost:5000/api` in `.env` at project root or `frontend/.env`.

## API endpoints (skeleton)

| Method | Path                         | Description              |
| ------ | ---------------------------- | ------------------------ |
| GET    | `/api/health`                | Health check             |
| GET    | `/api/light-points`          | List light points        |
| GET    | `/api/light-points/:id`      | Single light point       |
| POST   | `/api/reports/send`          | Submit fault report      |
| POST   | `/api/admin/login`           | Admin login (placeholder)|
| GET    | `/api/admin/light-points`    | Admin list (placeholder) |
| POST   | `/api/admin/light-points`    | Create (placeholder)     |
| PUT    | `/api/admin/light-points/:id` | Update (placeholder)  |
| DELETE | `/api/admin/light-points/:id` | Delete (placeholder)   |

## Status

This repository is a **clean skeleton** only:

- No full admin authentication
- No real AUSEMIO/DPMK HTTP integration
- No final UI design
- No long-term storage of citizen personal data in the database
