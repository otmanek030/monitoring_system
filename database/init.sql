-- =============================================================================
-- PHOSWATCH - Real-time Equipment Monitoring System
-- Database schema for OCP Benguerir Phosphate Washing & Flotation Plant
-- PostgreSQL 15 + TimescaleDB
--
-- Author  : EL BARNATY Othmane (PFE, EST Essaouira @ OCP Group)
-- Context : 4 Docker services (backend, ml-service, frontend, database)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;           -- crypt() for bcrypt-style hashes


-- =============================================================================
-- 1. REFERENCE / DIMENSION TABLES
-- =============================================================================

-- A phosphate complex may host several plants; we keep it simple (1 plant)
CREATE TABLE plants (
    plant_id        SERIAL PRIMARY KEY,
    code            VARCHAR(16) UNIQUE NOT NULL,
    name            VARCHAR(128) NOT NULL,
    location        VARCHAR(128),
    commissioned_on DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Plant areas (the real OCP tag prefixes: 230A, 300, 310A, 320A, 330A, 340G, 410A)
CREATE TABLE areas (
    area_id         SERIAL PRIMARY KEY,
    plant_id        INT NOT NULL REFERENCES plants(plant_id) ON DELETE CASCADE,
    code            VARCHAR(16) UNIQUE NOT NULL,
    name            VARCHAR(128) NOT NULL,
    description     TEXT,
    criticality     SMALLINT NOT NULL DEFAULT 3   -- 1 (low) ... 5 (critical)
);

-- ISA-5.1 equipment type codes (VP=pump, AG=agitator, XV=on/off valve, ...)
CREATE TABLE equipment_types (
    type_id         SERIAL PRIMARY KEY,
    code            VARCHAR(8)  UNIQUE NOT NULL,  -- VP, RP, SP, AG, CY, FY, LY, XV, TI, PI, LI, FI, MOT, CONV, STKR
    name            VARCHAR(64) NOT NULL,
    category        VARCHAR(32) NOT NULL,         -- pump | valve | motor | sensor | conveyor | stacker | cyclone ...
    description     TEXT
);

-- Physical equipment (pumps, valves, motors, conveyors, the stacker itself)
CREATE TABLE equipment (
    equipment_id    SERIAL PRIMARY KEY,
    area_id         INT NOT NULL REFERENCES areas(area_id) ON DELETE CASCADE,
    type_id         INT NOT NULL REFERENCES equipment_types(type_id),
    tag_code        VARCHAR(64) UNIQUE NOT NULL,  -- e.g. 310A_VP_01S, 320A_AG_2410
    name            VARCHAR(160) NOT NULL,
    description     TEXT,
    manufacturer    VARCHAR(64),
    model           VARCHAR(64),
    serial_number   VARCHAR(64),
    commissioned_on DATE,
    criticality     SMALLINT NOT NULL DEFAULT 3,  -- 1 ... 5
    status          VARCHAR(16) NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running','idle','stopped','maintenance','fault')),
    -- Expected operating life (hours) - baseline for RUL model
    expected_life_hours  INT,
    -- Cumulative runtime (updated periodically)
    runtime_hours   NUMERIC(12,2) DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_equipment_area ON equipment(area_id);
CREATE INDEX idx_equipment_type ON equipment(type_id);
CREATE INDEX idx_equipment_status ON equipment(status);

-- Individual sensors / measurement points attached to equipment
-- (e.g. the 5 winding/bearing temps on a single pump TI_5301_{D,E,F,G,H})
CREATE TABLE sensors (
    sensor_id       SERIAL PRIMARY KEY,
    equipment_id    INT NOT NULL REFERENCES equipment(equipment_id) ON DELETE CASCADE,
    tag_code        VARCHAR(96) UNIQUE NOT NULL,  -- full SCADA tag e.g. 310A_TI_5301_D
    name            VARCHAR(160) NOT NULL,
    description     TEXT,
    measurement     VARCHAR(32) NOT NULL,         -- vibration | temperature | pressure | flow | level | current | power | speed | position | status
    unit            VARCHAR(16) NOT NULL,         -- degC, bar, m3/h, %, mm/s, A, kW, rpm ...
    -- OPC UA / Modbus binding (real integration hooks)
    opc_node_id     VARCHAR(160),                 -- e.g. ns=2;s=310A.VP_01S.M01
    modbus_address  INT,
    modbus_type     VARCHAR(16),                  -- holding | input | coil | discrete
    sampling_period_ms  INT NOT NULL DEFAULT 1000,
    -- Operating range (for visualisation axes, sanity checks)
    range_min       NUMERIC,
    range_max       NUMERIC,
    -- Engineering limits (used by alarm engine AND threshold models)
    warn_low        NUMERIC,   -- L1 Warning
    warn_high       NUMERIC,   -- H1 Warning
    alarm_low       NUMERIC,   -- L2 Alarm
    alarm_high      NUMERIC,   -- H2 Alarm
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_sensors_equipment ON sensors(equipment_id);
CREATE INDEX idx_sensors_measurement ON sensors(measurement);


-- =============================================================================
-- 2. TIME-SERIES TABLES (TimescaleDB hypertables)
-- =============================================================================

-- Raw sensor readings  (the workhorse table; TimescaleDB hypertable)
CREATE TABLE sensor_readings (
    ts              TIMESTAMPTZ      NOT NULL,
    sensor_id       INT              NOT NULL REFERENCES sensors(sensor_id) ON DELETE CASCADE,
    value           DOUBLE PRECISION NOT NULL,
    quality         SMALLINT         NOT NULL DEFAULT 192,   -- OPC UA quality code (192 = Good)
    is_anomaly      BOOLEAN          NOT NULL DEFAULT FALSE, -- ground-truth label for ML training
    PRIMARY KEY (sensor_id, ts)
);
SELECT create_hypertable('sensor_readings', 'ts', chunk_time_interval => INTERVAL '1 day');
CREATE INDEX idx_readings_ts ON sensor_readings(ts DESC);

-- Compress older chunks (huge space savings; 24h retention hot, weeks cold)
ALTER TABLE sensor_readings SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'sensor_id',
    timescaledb.compress_orderby   = 'ts DESC'
);
SELECT add_compression_policy('sensor_readings', INTERVAL '3 days');

-- Continuous aggregate: 1-minute rollups (mean/min/max/stddev) per sensor
CREATE MATERIALIZED VIEW sensor_readings_1m
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 minute', ts) AS bucket,
    sensor_id,
    AVG(value)     AS avg_val,
    MIN(value)     AS min_val,
    MAX(value)     AS max_val,
    STDDEV(value)  AS std_val,
    COUNT(*)       AS n
FROM sensor_readings
GROUP BY bucket, sensor_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('sensor_readings_1m',
    start_offset     => INTERVAL '2 days',
    end_offset       => INTERVAL '1 minute',
    schedule_interval=> INTERVAL '1 minute');


-- =============================================================================
-- 3. ALARMS & EVENTS
-- =============================================================================

-- Alarm rule definitions (so new thresholds can be added from the UI)
CREATE TABLE alarm_definitions (
    alarm_def_id    SERIAL PRIMARY KEY,
    sensor_id       INT NOT NULL REFERENCES sensors(sensor_id) ON DELETE CASCADE,
    code            VARCHAR(32) NOT NULL,          -- L1_WARNING, H2_ALARM, DRIVE_NOT_READY ...
    condition_type  VARCHAR(16) NOT NULL
                    CHECK (condition_type IN ('high','low','deviation','rate','state')),
    threshold       NUMERIC,
    hysteresis      NUMERIC DEFAULT 0,
    severity        VARCHAR(16) NOT NULL
                    CHECK (severity IN ('info','warning','fatal','urgent')),
    priority        SMALLINT NOT NULL DEFAULT 3,
    message_fr      TEXT,
    message_en      TEXT,
    is_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (sensor_id, code)
);

-- Alarm occurrences (hypertable too - can grow fast)
CREATE TABLE alarms (
    alarm_id        BIGSERIAL,
    ts              TIMESTAMPTZ NOT NULL,              -- "In Time"
    cleared_ts      TIMESTAMPTZ,                       -- "Out Time"
    alarm_def_id    INT REFERENCES alarm_definitions(alarm_def_id),
    equipment_id    INT NOT NULL REFERENCES equipment(equipment_id) ON DELETE CASCADE,
    sensor_id       INT REFERENCES sensors(sensor_id),
    severity        VARCHAR(16) NOT NULL,
    priority        SMALLINT NOT NULL DEFAULT 3,
    message         TEXT NOT NULL,
    trigger_value   DOUBLE PRECISION,
    state_from      VARCHAR(32),                       -- "Normal"
    state_to        VARCHAR(32),                       -- "H1 Warning"
    acknowledged    BOOLEAN NOT NULL DEFAULT FALSE,
    acknowledged_by INT,                               -- users.user_id (FK added below)
    acknowledged_at TIMESTAMPTZ,
    PRIMARY KEY (alarm_id, ts)
);
SELECT create_hypertable('alarms', 'ts', chunk_time_interval => INTERVAL '7 days');
CREATE INDEX idx_alarms_equipment_ts ON alarms(equipment_id, ts DESC);
CREATE INDEX idx_alarms_active ON alarms(ts DESC) WHERE cleared_ts IS NULL;

-- Audit / control events (operator commands, setpoint changes, logins ...)
CREATE TABLE events (
    event_id        BIGSERIAL,
    ts              TIMESTAMPTZ NOT NULL,
    category        VARCHAR(32) NOT NULL,   -- Controls | Parameters | Setpoints | General | Ecc.System ...
    equipment_id    INT REFERENCES equipment(equipment_id) ON DELETE SET NULL,
    sensor_id       INT REFERENCES sensors(sensor_id)     ON DELETE SET NULL,
    user_id         INT,                    -- FK to users added below
    severity        VARCHAR(16),
    message         TEXT NOT NULL,
    old_value       TEXT,
    new_value       TEXT,
    source          VARCHAR(32) DEFAULT 'SCADA',      -- SCADA | HMI | API | ML
    PRIMARY KEY (event_id, ts)
);
SELECT create_hypertable('events', 'ts', chunk_time_interval => INTERVAL '7 days');
CREATE INDEX idx_events_equipment_ts ON events(equipment_id, ts DESC);
CREATE INDEX idx_events_category ON events(category);


-- =============================================================================
-- 4. USERS, ROLES, AUDIT
-- =============================================================================

CREATE TABLE roles (
    role_id     SERIAL PRIMARY KEY,
    code        VARCHAR(32) UNIQUE NOT NULL,  -- admin, supervisor, technician, operator, viewer
    name        VARCHAR(64) NOT NULL,
    description TEXT,
    permissions JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE users (
    user_id         SERIAL PRIMARY KEY,
    username        VARCHAR(64) UNIQUE NOT NULL,
    email           VARCHAR(128) UNIQUE NOT NULL,
    full_name       VARCHAR(128),
    password_hash   VARCHAR(255) NOT NULL,
    role_id         INT NOT NULL REFERENCES roles(role_id),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_login      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Late FKs on alarms/events to users (after users table exists)
ALTER TABLE alarms ADD CONSTRAINT fk_alarms_user
    FOREIGN KEY (acknowledged_by) REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE events ADD CONSTRAINT fk_events_user
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL;

-- 8h shifts typical of a 3x8 mining operation
CREATE TABLE shifts (
    shift_id    SERIAL PRIMARY KEY,
    code        VARCHAR(16) UNIQUE NOT NULL,  -- MORNING | AFTERNOON | NIGHT
    name        VARCHAR(64) NOT NULL,
    start_time  TIME NOT NULL,
    end_time    TIME NOT NULL
);

CREATE TABLE operator_shifts (
    id          SERIAL PRIMARY KEY,
    user_id     INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    shift_id    INT NOT NULL REFERENCES shifts(shift_id),
    shift_date  DATE NOT NULL,
    UNIQUE (user_id, shift_date, shift_id)
);


-- =============================================================================
-- 5. MAINTENANCE
-- =============================================================================

CREATE TABLE maintenance_orders (
    order_id        SERIAL PRIMARY KEY,
    equipment_id    INT NOT NULL REFERENCES equipment(equipment_id) ON DELETE CASCADE,
    order_type      VARCHAR(24) NOT NULL
                    CHECK (order_type IN ('preventive','corrective','predictive','inspection','calibration')),
    priority        VARCHAR(16) NOT NULL DEFAULT 'normal'
                    CHECK (priority IN ('low','normal','high','urgent')),
    title           VARCHAR(160) NOT NULL,
    description     TEXT,
    status          VARCHAR(16) NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','scheduled','in_progress','completed','cancelled')),
    created_by      INT REFERENCES users(user_id),
    assigned_to     INT REFERENCES users(user_id),
    -- If this was triggered by a prediction, keep the link
    triggered_by_prediction_id BIGINT,
    planned_start   TIMESTAMPTZ,
    planned_end     TIMESTAMPTZ,
    actual_start    TIMESTAMPTZ,
    actual_end      TIMESTAMPTZ,
    cost            NUMERIC(12,2),
    parts_replaced  TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_mo_equipment ON maintenance_orders(equipment_id);
CREATE INDEX idx_mo_status ON maintenance_orders(status);


-- =============================================================================
-- 6. MACHINE LEARNING
-- =============================================================================

CREATE TABLE ml_models (
    model_id        SERIAL PRIMARY KEY,
    name            VARCHAR(64) NOT NULL,       -- anomaly_iforest | predictive_xgb | rul_lstm
    model_type      VARCHAR(32) NOT NULL,       -- anomaly | predictive | rul
    version         VARCHAR(16) NOT NULL,
    algorithm       VARCHAR(64),                -- IsolationForest | XGBoost | LSTM
    training_range_start TIMESTAMPTZ,
    training_range_end   TIMESTAMPTZ,
    metrics         JSONB,                      -- {"precision":0.94,"recall":0.91,"rmse":7.2}
    path            VARCHAR(255),               -- /app/models/rul_lstm_v2.pkl
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (name, version)
);

-- Anomaly scores (Isolation Forest)
CREATE TABLE predictions_anomaly (
    ts              TIMESTAMPTZ NOT NULL,
    sensor_id       INT NOT NULL REFERENCES sensors(sensor_id) ON DELETE CASCADE,
    model_id        INT NOT NULL REFERENCES ml_models(model_id),
    anomaly_score   DOUBLE PRECISION NOT NULL,  -- [-1, 1] negative = more anomalous
    is_anomaly      BOOLEAN NOT NULL,
    explanation     JSONB,                      -- feature contributions / SHAP
    PRIMARY KEY (sensor_id, ts)
);
SELECT create_hypertable('predictions_anomaly', 'ts', chunk_time_interval => INTERVAL '7 days');

-- Failure predictions (XGBoost, 7-14 day horizon)
CREATE TABLE predictions_failure (
    prediction_id   BIGSERIAL,
    ts              TIMESTAMPTZ NOT NULL,
    equipment_id    INT NOT NULL REFERENCES equipment(equipment_id) ON DELETE CASCADE,
    model_id        INT NOT NULL REFERENCES ml_models(model_id),
    horizon_days    SMALLINT NOT NULL,          -- 7 or 14
    failure_prob    DOUBLE PRECISION NOT NULL,  -- 0..1
    predicted_class VARCHAR(32),                -- bearing_fault | winding_overheat | cavitation | misalignment | belt_slip
    confidence      DOUBLE PRECISION,
    PRIMARY KEY (prediction_id, ts)
);
SELECT create_hypertable('predictions_failure', 'ts', chunk_time_interval => INTERVAL '30 days');
CREATE INDEX idx_predf_equipment ON predictions_failure(equipment_id, ts DESC);

-- RUL predictions (LSTM)
CREATE TABLE predictions_rul (
    ts              TIMESTAMPTZ NOT NULL,
    equipment_id    INT NOT NULL REFERENCES equipment(equipment_id) ON DELETE CASCADE,
    model_id        INT NOT NULL REFERENCES ml_models(model_id),
    rul_hours       DOUBLE PRECISION NOT NULL,
    rul_lower_95    DOUBLE PRECISION,           -- confidence interval
    rul_upper_95    DOUBLE PRECISION,
    health_index    DOUBLE PRECISION,           -- 0..1 (1=healthy, 0=end-of-life)
    PRIMARY KEY (equipment_id, ts)
);
SELECT create_hypertable('predictions_rul', 'ts', chunk_time_interval => INTERVAL '30 days');


-- =============================================================================
-- 7. REPORTING
-- =============================================================================

CREATE TABLE reports (
    report_id    SERIAL PRIMARY KEY,
    name         VARCHAR(128) NOT NULL,
    report_type  VARCHAR(32) NOT NULL,   -- daily | weekly | monthly | custom
    format       VARCHAR(8)  NOT NULL,   -- xlsx | pdf
    period_start TIMESTAMPTZ NOT NULL,
    period_end   TIMESTAMPTZ NOT NULL,
    generated_by INT REFERENCES users(user_id),
    file_path    VARCHAR(255),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =============================================================================
-- 8. HELPFUL VIEWS (for the backend REST/WebSocket layer and the dashboard)
-- =============================================================================

-- Latest reading per sensor (used by the dashboard gauges)
CREATE OR REPLACE VIEW v_sensor_latest AS
SELECT DISTINCT ON (sensor_id)
    sensor_id, ts, value, quality, is_anomaly
FROM sensor_readings
ORDER BY sensor_id, ts DESC;

-- Active (uncleared) alarms
CREATE OR REPLACE VIEW v_alarms_active AS
SELECT a.*, e.tag_code AS equipment_tag, e.name AS equipment_name,
       s.tag_code AS sensor_tag
FROM alarms a
JOIN equipment e  ON e.equipment_id = a.equipment_id
LEFT JOIN sensors s ON s.sensor_id = a.sensor_id
WHERE a.cleared_ts IS NULL;

-- Equipment health (health_index from latest RUL prediction, fallback 1.0)
CREATE OR REPLACE VIEW v_equipment_health AS
SELECT e.equipment_id, e.tag_code, e.name, e.status, e.criticality,
       COALESCE(rul.health_index, 1.0) AS health_index,
       rul.rul_hours, rul.ts AS health_ts
FROM equipment e
LEFT JOIN LATERAL (
    SELECT health_index, rul_hours, ts
    FROM predictions_rul
    WHERE equipment_id = e.equipment_id
    ORDER BY ts DESC LIMIT 1
) rul ON TRUE;

COMMENT ON TABLE sensor_readings  IS 'Raw time-series measurements (TimescaleDB hypertable).';
COMMENT ON TABLE alarms           IS 'Alarm occurrences with acknowledgement workflow.';
COMMENT ON TABLE events           IS 'Audit trail - operator commands, setpoint changes, logins.';
COMMENT ON TABLE predictions_rul  IS 'Remaining Useful Life predictions from LSTM model.';