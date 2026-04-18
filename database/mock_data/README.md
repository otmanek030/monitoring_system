# Mock time-series data generator

Generates 14 days of realistic SCADA telemetry, alarms, events, maintenance
orders and ML predictions against the already-seeded phoswatch database.

## Injected fault scenarios (ground truth for ML training)

| Equipment      | Fault              | Class         | Window (day offset) |
|----------------|--------------------|---------------|---------------------|
| 310A_VP_01S    | Bearing fault      | progressive   | 9 → 14              |
| 340G_SP_12     | Winding overheat   | sudden trip   | 10.2 → 10.5         |
| 330A_CY_03     | UF density drift   | process       | 6 → 9               |
| 410A_CONV_B5   | Belt slip          | intermittent  | 2 short bursts      |

## How to run

The database stack must be up (`docker-compose up -d database`) and
`seed.sql` must have already populated the dimension tables.

### Option A — from your Windows host with Python installed

```powershell
cd C:\Users\OTHMANE\PFE\phoswatch\database\mock_data
pip install -r requirements.txt
python generate.py
```
The script connects to `localhost:5432` (the port exposed by docker-compose).

### Option B — from inside the container (no local Python needed)

```powershell
docker cp generate.py phoswatch-database:/tmp/generate.py
docker exec -it phoswatch-database sh -c "apk add --no-cache py3-pip py3-numpy && pip3 install --break-system-packages psycopg2-binary && python3 /tmp/generate.py"
```
(The TimescaleDB image is Alpine-based, hence `apk`.)

### Option C — add a one-shot helper service to docker-compose.yml

```yaml
  seeder:
    image: python:3.11-slim
    depends_on: { database: { condition: service_healthy } }
    environment:
      DATABASE_URL: postgresql://phoswatch_user:phoswatch_pass@database:5432/phoswatch_db
    volumes:
      - ./database/mock_data:/work
    working_dir: /work
    command: >
      sh -c "pip install -q -r requirements.txt && python generate.py"
    profiles: ["seed"]
```
Then run: `docker-compose --profile seed run --rm seeder`.

## Volume estimates

With the defaults (14 days, 30s bucket, 36 sensors):

| Table                | ~Rows      |
|----------------------|------------|
| sensor_readings      | 1,450,000  |
| predictions_anomaly  |    12,100  |
| predictions_failure  |       224  |
| predictions_rul      |       112  |
| alarms               |       ~50  |
| events               |       300  |
| maintenance_orders   |        10  |
| operator_shifts      |        ~60 |

Generation takes about 1-3 minutes depending on your disk.

## Tuning

Open `generate.py` and edit:

- `START_TS / END_TS` — change the window
- `BUCKET_S`          — 10 for higher resolution, 60 for lighter
- `FAULT_SCENARIOS`   — add/remove faults to train your ML models on
- `BASE_PROFILE`      — tweak physical baselines per measurement type
