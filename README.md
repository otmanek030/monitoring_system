# Phoswatch — Real-time Equipment Monitoring

Production-ready monitoring system for the OCP Benguerir phosphate washing &
flotation plant, built as a Docker microservices stack with a Node.js REST
+ WebSocket backend, a Python FastAPI ML service (anomaly detection,
predictive maintenance, RUL), a React + Recharts dashboard, and PostgreSQL
+ TimescaleDB for time-series storage.

Author: **EL BARNATY Othmane** — PFE 2026 · EST Essaouira · ISIL
Supervisor: **FAHMI Abderrahim** — OCP Group / Mining Division, Benguerir

## Architecture

```
          ┌─────────────────┐       ┌──────────────────┐
Browser ──┤  frontend:80    │◄─────►│  backend:3000    │──── Socket.io rooms
          │  (React+nginx)  │  /api │  (Express+JWT)   │     · dashboard
          └─────────────────┘       └──────────────────┘     · equipment:<id>
                                            │  │
                                            │  └──► ml-service:8000 (FastAPI)
                                            ▼       · /predict/anomaly
                                       database:5432       · /predict/failure
                                   (Postgres+TimescaleDB)  · /predict/rul
```

Inside the Docker network, services reach each other by service name
(`backend`, `ml-service`, `database`, `frontend`). The nginx in the frontend
container proxies `/api/*` and `/socket.io/*` to `backend:3000`.

## Quick start

```bash
# 1. clone & enter
cd phoswatch/

# 2. bring the whole stack up (first run builds images)
docker-compose up -d --build

# 3. tail logs while it warms up
docker-compose logs -f backend ml-service

# 4. open the dashboard
open http://localhost/          # sign in with   admin / phoswatch123
```

The `database` container loads `01-init.sql` (schema + TimescaleDB hyper-
tables) and then `02-seed.sql` (plant, areas, equipment, sensors, roles,
users) automatically on its first boot.

The `ml-service` bootstraps-trains tiny synthetic versions of all three
models on the first start if no artefact is present under
`/app/models/`. Models are persisted to the `ml_models` named volume.

The `backend` container starts a built-in data generator that publishes
realistic sinusoidal readings for every seeded sensor, so the dashboard and
AI predictions work end-to-end without a real SCADA connection.

## Services

### `backend/`  — Node.js 18 + Express + Socket.io

* REST API (JWT-auth, RBAC, rate-limited, Winston logging)
* `src/services/websocket.js` emits `reading` and `alarm:new` events to
  room `dashboard` and per-equipment rooms `equipment:<id>`.
* `src/services/alarmEngine.js` is an in-memory state machine
  (`normal → h1 → h2 → h1 → normal`) that creates / closes alarm rows
  based on sensor thresholds.
* `src/services/dataGenerator.js` synthesises live readings every 2 s.
* `src/services/mlClient.js` is the HTTP client to `ml-service` with
  timeouts, retries and graceful degradation.
* `src/utils/scadaConnector.js` ready for OPC UA production cut-over
  (lazy-loads `node-opcua`, reads `sensor.opc_node_id`).

### `ml-service/` — Python 3.11 + FastAPI

* `app/services/anomaly_detection.py` — IsolationForest pipeline
  (`StandardScaler + IsolationForest`) over a 10-dimensional window
  feature vector (mean, std, min, max, p25, p75, range, last, slope,
  jerk).
* `app/services/predictive_maintenance.py` — XGBoost multi-class
  classifier over pooled sensor features. Returns per-mode probabilities.
* `app/services/rul_estimation.py` — MLPRegressor hour-based estimator
  fused with a physics prior `0.7·model + 0.3·prior` → health index.
* `POST /train/{model}` re-trains on demand using recent DB data or
  synthetic fallbacks.

### `frontend/` — React 18 + React Router v6 + Recharts

* `pages/Dashboard.js` — KPIs, 4 live Recharts lines, active alarms.
* `pages/EquipmentDetail.js` — full sensor grid + AI panel for one asset.
* `pages/Predictions.js` — interactive anomaly/failure console with
  history chart.
* `pages/Alarms.js` — filterable alarm log with inline Ack / Clear.
* `pages/Maintenance.js` — work-order CRUD.
* `pages/Users.js` — admin-only user management.
* `pages/Reports.js` — xlsx / pdf exports.
* `services/websocket.js` — `useLiveFeed` hook with ring-buffer storage.

### `database/` — PostgreSQL 15 + TimescaleDB 2.x

* `init.sql` — schema (plants, areas, equipment, sensors, alarms,
  users, roles, maintenance orders, ML predictions caches). Creates
  hypertable on `sensor_readings` and continuous aggregates
  `v_sensor_latest`, `v_alarms_active`, `v_equipment_health`.
* `seed.sql` — 1 plant (BEN-WF1) · 7 areas · 11 equipment types · 8
  assets · ~30 sensors · 5 roles · 5 users · 3 shifts.

## Seed credentials

| Username | Password        | Role       |
|----------|-----------------|------------|
| admin    | phoswatch123    | admin      |
| fahmi    | phoswatch123    | supervisor |
| othmane  | phoswatch123    | technician |
| tech1    | phoswatch123    | technician |
| op1      | phoswatch123    | operator   |

## API (selected endpoints)

```
POST   /api/auth/login
GET    /api/auth/me

GET    /api/equipment                  · list
GET    /api/equipment/:id              · detail
GET    /api/equipment/:id/sensors
GET    /api/equipment/health           · health-index overview

GET    /api/sensors/latest             · last point per sensor
GET    /api/sensors/:id/readings?from=&to=&bucket=1min

GET    /api/alarms?status=active       · list / filter
POST   /api/alarms/:id/ack
POST   /api/alarms/:id/clear

POST   /api/predictions/anomaly        · { sensor_id, window_minutes }
POST   /api/predictions/failure        · { equipment_id, horizon_days }
GET    /api/predictions/rul/:eqId
GET    /api/predictions/health

GET    /api/maintenance                · orders CRUD
POST   /api/maintenance
PATCH  /api/maintenance/:id
DELETE /api/maintenance/:id

GET    /api/users                      · admin only
POST   /api/users

GET    /api/reports/equipment/:id/xlsx?from=&to=
GET    /api/reports/equipment/:id/pdf?from=&to=
GET    /api/reports/alarms/xlsx?from=&to=
GET    /api/reports/summary/pdf?from=&to=
```

All non-auth endpoints require `Authorization: Bearer <token>`; access is
further restricted by role-based permissions stored in `roles.permissions`.

## Real-time events

`/socket.io` — authenticated via `auth.token` in the handshake.

```
event            payload
─────            ───────
reading          { sensor_id, equipment_id, ts, value, quality }
alarm:new        { id, sensor_id, equipment_id, severity, message, opened_at }
alarm:clear      { id, closed_at }
equipment:state  { id, status, health_score }
```

Subscribe selectively with `socket.emit('subscribe:equipment', id)` — the
`useLiveFeed` hook on the frontend does this automatically.

## Tests

```bash
# Backend
docker-compose exec backend npm test

# ML service
docker-compose exec ml-service pytest -q
```

## Folder layout

```
phoswatch/
├── docker-compose.yml
├── README.md
├── CLAUDE.md                  ← project instructions (context)
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── .env
│   └── src/
│       ├── app.js · server.js · index.js
│       ├── config/    (env, logger, db pool)
│       ├── middleware/(auth, validate, errorHandler)
│       ├── controllers/
│       ├── routes/
│       ├── services/  (mlClient, alarmEngine, dataGenerator, websocket, exporters)
│       └── utils/     (scadaConnector)
├── ml-service/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py · config.py
│       ├── api/endpoints.py
│       ├── database/db_connector.py
│       ├── schemas/payloads.py
│       ├── services/  (anomaly, predictive_maintenance, rul)
│       └── utils/data_processor.py
├── frontend/
│   ├── Dockerfile · nginx.conf
│   └── src/
│       ├── App.js · index.js
│       ├── contexts/AuthContext.js
│       ├── components/
│       │   ├── Layout.js · ProtectedRoute.js
│       │   ├── Dashboard/  (KPICards, RealTimeChart, AlertsPanel)
│       │   ├── ML/         (AnomalyDisplay, RULIndicator)
│       │   └── Reports/    (ExportButton, ReportGenerator)
│       ├── pages/     (Login, Dashboard, Equipment, EquipmentDetail,
│       │               Alarms, Predictions, Maintenance, Reports, Users)
│       ├── services/  (api.js, websocket.js)
│       └── styles/App.css
└── database/
    ├── init.sql   ← schema + Timescale hypertables
    └── seed.sql   ← plant, areas, equipment, sensors, users
```

## Troubleshooting

* **`frontend` shows "Login failed" / 401** — the DB may still be
  initialising. `docker-compose logs database` should show
  `database system is ready to accept connections`, then retry.
* **ML service `503 Service Unavailable`** — it's still training the
  bootstrap models. `docker-compose logs ml-service` — wait until
  `Models loaded: anomaly=ok, failure=ok, rul=ok`.
* **No live readings on dashboard** — make sure
  `DATA_GENERATOR_ENABLED=true` in `backend/.env` (default), or plug in
  SCADA via `OPCUA_ENDPOINT`.
* **Charts empty on first load** — the ring buffer is populated by
  WebSocket pushes. Give it ~5 s.

## License

Internal academic project — OCP Group / EST Essaouira (PFE 2026).

## For the data base   

Your database lives in two places — the SQL definitions on disk and the actual running data inside a Docker volume.
SQL files on disk (the schema and seed data that build the DB on first start):

C:\Users\OTHMANE\PFE\phoswatch\database\init.sql — tables, hypertables, indexes, TimescaleDB setup
C:\Users\OTHMANE\PFE\phoswatch\database\seed.sql — initial rows (equipment, sensors, users, roles)
C:\Users\OTHMANE\PFE\phoswatch\database\03-roles-upgrade.sql — the roles/permissions + operator_notes migration
C:\Users\OTHMANE\PFE\phoswatch\database\mock_data\ — CSV / mock readings

The actual database data (rows currently being read/written):

Container name: phoswatch-database
Image: timescale/timescaledb:latest-pg15
Host port: 5432
Credentials: user phoswatch_user, password phoswatch_pass, db phoswatch_db
Data storage: Docker named volume postgres_data, mounted inside the container at /var/lib/postgresql/data

Useful commands (PowerShell):
powershell# See the volume on your host
docker volume inspect phoswatch_postgres_data

# Open an interactive psql shell inside the container
docker exec -it phoswatch-database psql -U phoswatch_user -d phoswatch_db

# List all tables
docker exec -it phoswatch-database psql -U phoswatch_user -d phoswatch_db -c "\dt"

# Quick row counts
docker exec -it phoswatch-database psql -U phoswatch_user -d phoswatch_db -c "SELECT COUNT(*) FROM sensor_readings;"

# Connect from an external client (DBeaver, pgAdmin, DataGrip)
# Host: localhost   Port: 5432   DB: phoswatch_db


# FOR THE CHANGES 

