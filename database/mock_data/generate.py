#!/usr/bin/env python3
"""
PHOSWATCH - Mock time-series data generator
============================================
Reads the sensor catalogue from the DB (populated by seed.sql) and generates
14 days of realistic SCADA telemetry, alarms, events, maintenance orders and
ML predictions, then bulk-loads everything via COPY.

Injected fault scenarios (ground truth for ML training/validation):
  1. 310A_VP_01S - progressive bearing fault: vibration & bearing temp rise
                   over the last 5 days (slow degradation).
  2. 340G_SP_12  - winding overheat TRIP on day 10 (sudden fault, equipment
                   goes to 'fault', restored after 6h maintenance).
  3. 330A_CY_03  - UF density drift over 3 days (process control issue).
  4. 410A_CONV_B5 - belt slip events (2 short bursts of speed drop & current spike).

Usage (from your host, with the phoswatch stack running):
    docker exec -it phoswatch-database \\
        sh -c 'pip install -q psycopg2-binary numpy && python3 /mnt/generate.py'

OR mount this file and run locally against the exposed port 5432:
    pip install psycopg2-binary numpy
    python generate.py
"""

import os
import math
import random
import json
from datetime import datetime, timedelta, timezone
from io import StringIO

import numpy as np
import psycopg2
import psycopg2.extras

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------
DB_URL  = os.getenv("DATABASE_URL",
                    "postgresql://phoswatch_user:phoswatch_pass@localhost:5432/phoswatch_db")

# Simulation window: 14 days ending "now" (rounded to a minute)
END_TS   = datetime.now(timezone.utc).replace(second=0, microsecond=0)
START_TS = END_TS - timedelta(days=14)

# Coarse bucket for sensor readings. Real SCADA would sample faster, but 30s
# gives ~40k points/sensor/14d — plenty for ML demos and keeps load time sane.
BUCKET_S    = 30
N_BUCKETS   = int((END_TS - START_TS).total_seconds() // BUCKET_S)

RANDOM_SEED = 42
random.seed(RANDOM_SEED)
np.random.seed(RANDOM_SEED)


# -----------------------------------------------------------------------------
# Measurement baselines / physical characteristics by sensor measurement type
# -----------------------------------------------------------------------------
# Each entry: (centre, daily_amp, period_s, noise_sigma)
#   centre      - typical operating value
#   daily_amp   - diurnal swing amplitude
#   period_s    - periodicity (daily=86400, shift=28800, process=3600 ...)
#   noise_sigma - Gaussian noise as fraction of centre
BASE_PROFILE = {
    "vibration":   (2.2,   0.3,  3600,  0.15),   # mm/s RMS
    "temperature": (55.0,  8.0,  86400, 0.04),   # degC (bearings/winding baseline)
    "pressure":    (6.0,   0.6,  3600,  0.05),   # bar
    "flow":        (420.0, 60.0, 3600,  0.06),   # m3/h
    "level":       (60.0,  10.0, 1800,  0.08),   # %
    "current":     (280.0, 40.0, 3600,  0.05),   # A
    "power":       (180.0, 30.0, 3600,  0.05),   # kW
    "speed":       (1485.0, 5.0, 86400, 0.005),  # rpm (very stable)
    "density":     (1650.0, 50.0, 3600, 0.03),   # kg/m3
    "ph":          (9.2,   0.3,  3600,  0.02),   # pH
}


# -----------------------------------------------------------------------------
# Faults to inject (ground truth)
# -----------------------------------------------------------------------------
# Each fault describes how to perturb the baseline value of sensors on a given
# equipment over a specific time window.
FAULT_SCENARIOS = [
    {
        "equipment_tag": "310A_VP_01S",
        "type": "bearing_fault",
        "class": "progressive",
        "start_offset_days": 9,     # appears 9 days into the 14d window
        "end_offset_days":  14,     # ongoing at the end (this is the headline fault)
        "affects": {
            "vibration":   {"drift_to": 2.8, "noise_mult": 2.5},  # 2.2 -> +2.8 mm/s
            "temperature": {"drift_to": 18.0, "only_tag_suffix": ["TI_5301_D", "TI_5301_E"]},
        },
    },
    {
        "equipment_tag": "340G_SP_12",
        "type": "winding_overheat",
        "class": "sudden_trip",
        "start_offset_days": 10.2,
        "end_offset_days":  10.5,   # trip, then stop
        "affects": {
            "temperature": {"spike_to": 140.0, "only_tag_suffix": ["TI_SP_12_B"]},
            "current":     {"spike_to": 550.0},
            "vibration":   {"spike_to": 9.5},
        },
        "causes_stop": True,
        "stop_duration_h": 6,
    },
    {
        "equipment_tag": "330A_CY_03",
        "type": "density_drift",
        "class": "process",
        "start_offset_days": 6,
        "end_offset_days":  9,
        "affects": {
            "density":  {"drift_to": 120.0, "only_tag_suffix": ["DI_CY_03_UF"]},
            "pressure": {"drift_to": 0.8},
        },
    },
    {
        "equipment_tag": "410A_CONV_B5",
        "type": "belt_slip",
        "class": "intermittent",
        # two short bursts
        "bursts": [
            (4.3, 4.35),   # day-offset start, end (~1.2h each)
            (11.7, 11.75),
        ],
        "affects": {
            "speed":   {"drop_to": 0.75},   # -25%
            "current": {"spike_to": 1.35},  # +35%
        },
    },
]


# =============================================================================
# Helpers
# =============================================================================
def copy_from_rows(cur, table, columns, rows, chunk=50_000):
    """Fast bulk-load via COPY FROM STDIN (text format)."""
    buf = StringIO()
    for i, row in enumerate(rows, 1):
        line = "\t".join("\\N" if v is None else str(v) for v in row)
        buf.write(line + "\n")
        if i % chunk == 0:
            buf.seek(0)
            cur.copy_expert(
                f"COPY {table} ({','.join(columns)}) FROM STDIN WITH (FORMAT text, NULL '\\N')",
                buf)
            buf.close(); buf = StringIO()
    if buf.tell():
        buf.seek(0)
        cur.copy_expert(
            f"COPY {table} ({','.join(columns)}) FROM STDIN WITH (FORMAT text, NULL '\\N')",
            buf)
    buf.close()


def tag_matches(tag, suffixes):
    return any(tag.endswith(s) for s in suffixes)


# =============================================================================
# Main generators
# =============================================================================
def generate_sensor_readings(conn, sensors, equipment_by_tag):
    """Generate readings for every sensor across the whole window, with faults."""
    print(f"  • {len(sensors)} sensors × {N_BUCKETS} buckets = {len(sensors)*N_BUCKETS:,} rows")

    # Time axis (numpy datetime64 for speed, then convert per chunk)
    t_axis = np.array([START_TS + timedelta(seconds=i*BUCKET_S)
                       for i in range(N_BUCKETS)])

    # Pre-compute time-of-day normalised (0..1) and elapsed days
    t_sec     = np.array([i * BUCKET_S for i in range(N_BUCKETS)], dtype=np.float64)
    days      = t_sec / 86400.0           # elapsed days from START_TS

    rows = []       # (ts, sensor_id, value, quality, is_anomaly)
    readings_count = 0

    # Fault lookup by equipment_tag
    fault_by_equip = {}
    for f in FAULT_SCENARIOS:
        fault_by_equip.setdefault(f["equipment_tag"], []).append(f)

    for s in sensors:
        meas = s["measurement"]
        if meas not in BASE_PROFILE:
            continue  # skip unknown types

        centre, amp, period_s, noise = BASE_PROFILE[meas]

        # Override centre using the sensor's warn_high/range_max if available
        if s["range_max"] is not None and s["range_min"] is not None:
            mid = (float(s["range_max"]) + float(s["range_min"])) / 2
            centre = mid * 0.55 if meas not in ("ph",) else centre
        if s["warn_high"] is not None and meas in ("vibration", "temperature"):
            # keep centre well below warn_high to leave room for faults
            centre = float(s["warn_high"]) * 0.55

        # Baseline signal
        base = centre + amp * np.sin(2*math.pi * t_sec / period_s)

        # Equipment-level on/off: stacker is idle most of the time.
        equip = equipment_by_tag.get(s["equipment_tag"].split("_")[0] + "_" +
                                      s["equipment_tag"].split("_")[1] + "_" +
                                      s["equipment_tag"].split("_")[2], None)
        # Simpler: map by equipment_id
        equip = next((e for e in equipment_by_tag.values()
                      if e["equipment_id"] == s["equipment_id"]), None)

        running_mask = np.ones(N_BUCKETS, dtype=bool)
        if equip and equip["status"] == "idle":
            # 80% idle, 20% running in short windows of ~2-3h
            running_mask[:] = False
            n_runs = 18
            for _ in range(n_runs):
                start = np.random.randint(0, N_BUCKETS - 360)
                dur   = np.random.randint(120, 360)
                running_mask[start:start+dur] = True

        # Apply fault perturbations
        is_anomaly = np.zeros(N_BUCKETS, dtype=bool)
        faults = fault_by_equip.get(equip["tag_code"], []) if equip else []

        for f in faults:
            affects = f["affects"].get(meas)
            if affects is None:
                continue
            # Filter by tag suffix if specified
            suf = affects.get("only_tag_suffix")
            if suf and not tag_matches(s["tag_code"], suf):
                continue

            if "bursts" in f:
                for (d0, d1) in f["bursts"]:
                    mask = (days >= d0) & (days <= d1)
                    if "drop_to" in affects:
                        base[mask] *= affects["drop_to"]
                    if "spike_to" in affects:
                        base[mask] *= affects["spike_to"]
                    is_anomaly |= mask
            else:
                d0 = f["start_offset_days"]; d1 = f["end_offset_days"]
                mask = (days >= d0) & (days <= d1)
                if "drift_to" in affects:
                    # linear ramp
                    progress = np.clip((days - d0) / max(d1 - d0, 0.01), 0, 1)
                    base = np.where(mask, base + affects["drift_to"] * progress, base)
                if "spike_to" in affects:
                    base = np.where(mask, affects["spike_to"], base)
                if "noise_mult" in affects:
                    extra_noise = np.random.normal(0, abs(centre*noise) * (affects["noise_mult"]-1), N_BUCKETS)
                    base = np.where(mask, base + extra_noise, base)
                is_anomaly |= mask

        # Gaussian noise
        values = base + np.random.normal(0, abs(centre*noise), N_BUCKETS)

        # Idle => drop to ~0 with small floor noise
        values = np.where(running_mask, values,
                          np.random.normal(0, abs(centre*noise*0.5), N_BUCKETS))

        # Clip to range
        if s["range_min"] is not None:
            values = np.maximum(values, float(s["range_min"]))
        if s["range_max"] is not None:
            values = np.maximum(np.minimum(values, float(s["range_max"]) * 1.15),
                                float(s["range_min"] or 0))

        # Emit rows
        for i in range(N_BUCKETS):
            rows.append((t_axis[i].isoformat(), s["sensor_id"],
                         round(float(values[i]), 4), 192,
                         "t" if is_anomaly[i] else "f"))
        readings_count += N_BUCKETS

        # Flush in chunks to keep memory bounded
        if len(rows) >= 200_000:
            _flush_readings(conn, rows)
            rows = []

    if rows:
        _flush_readings(conn, rows)
    print(f"  ✓ {readings_count:,} sensor readings written")


def _flush_readings(conn, rows):
    with conn.cursor() as cur:
        copy_from_rows(cur, "sensor_readings",
                       ["ts", "sensor_id", "value", "quality", "is_anomaly"],
                       rows)
    conn.commit()


def generate_alarms(conn, sensors, alarm_defs, equipment_by_id):
    """Synthesize alarm events: walk each sensor and detect threshold crossings."""
    rows = []
    # Simple rule: any sensor value crossing warn/alarm thresholds produces an alarm.
    # We sample 1% of the readings (coarser) to avoid alarm-storm from noise.
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            WITH sampled AS (
                SELECT sensor_id, ts, value,
                       LAG(value) OVER (PARTITION BY sensor_id ORDER BY ts) AS prev_value
                FROM sensor_readings
                WHERE ts >= %s
            )
            SELECT s.sensor_id, s.equipment_id, s.tag_code, s.measurement,
                   s.warn_low, s.warn_high, s.alarm_low, s.alarm_high,
                   sampled.ts, sampled.value, sampled.prev_value
            FROM sampled
            JOIN sensors s USING (sensor_id)
            WHERE sampled.prev_value IS NOT NULL
              AND (
                   (s.warn_high  IS NOT NULL AND sampled.value > s.warn_high  AND sampled.prev_value <= s.warn_high)
                OR (s.alarm_high IS NOT NULL AND sampled.value > s.alarm_high AND sampled.prev_value <= s.alarm_high)
                OR (s.warn_low   IS NOT NULL AND sampled.value < s.warn_low   AND sampled.prev_value >= s.warn_low)
                OR (s.alarm_low  IS NOT NULL AND sampled.value < s.alarm_low  AND sampled.prev_value >= s.alarm_low)
              )
            ORDER BY sampled.ts
        """, (START_TS,))
        crossings = cur.fetchall()

    print(f"  • detected {len(crossings)} threshold crossings")

    # Group crossings per sensor+level to create (in/out) pairs
    active = {}   # key -> (ts_in, severity, state_to, value)
    for c in crossings:
        val = float(c["value"])
        level, severity, sev_state = None, None, None
        if c["alarm_high"] is not None and val > float(c["alarm_high"]):
            level, severity, sev_state = "H2_ALARM", "fatal",   "H2 Alarm"
        elif c["warn_high"] is not None and val > float(c["warn_high"]):
            level, severity, sev_state = "H1_WARNING", "warning", "H1 Warning"
        elif c["alarm_low"] is not None and val < float(c["alarm_low"]):
            level, severity, sev_state = "L2_ALARM", "fatal",   "L2 Alarm"
        elif c["warn_low"] is not None and val < float(c["warn_low"]):
            level, severity, sev_state = "L1_WARNING", "warning", "L1 Warning"
        if level is None:
            continue

        key = (c["sensor_id"], level)
        if key not in active:
            # Alarm IN
            active[key] = {"ts_in": c["ts"], "severity": severity, "state": sev_state,
                           "value": val, "equipment_id": c["equipment_id"]}
        # If same sensor crosses back below warn_low/above warn_high we'd clear, but
        # the LAG query doesn't give us that — keep it simple: random clear time 15-120 min later.

    # Flatten
    for (sensor_id, level), a in active.items():
        clear_dt = a["ts_in"] + timedelta(minutes=random.randint(15, 180))
        message  = f"Alarm: Normal -> {a['state']} (value={a['value']:.2f})"
        rows.append((
            a["ts_in"].isoformat(), clear_dt.isoformat(), None,
            a["equipment_id"], sensor_id,
            a["severity"], 2 if a["severity"] == "warning" else 3,
            message, a["value"], "Normal", a["state"],
            "f", None, None,
        ))

    # Add some state-based alarms from the injected faults (non-sensor ones)
    for f in FAULT_SCENARIOS:
        equip = next((e for e in equipment_by_id.values() if e["tag_code"] == f["equipment_tag"]), None)
        if not equip: continue
        if f["type"] == "winding_overheat":
            ts_in  = START_TS + timedelta(days=f["start_offset_days"])
            ts_out = START_TS + timedelta(days=f["end_offset_days"])
            rows.append((ts_in.isoformat(), ts_out.isoformat(), None,
                         equip["equipment_id"], None, "urgent", 1,
                         "THERMIQUE_MOTEUR: Winding overheat trip - motor stopped by protection relay",
                         140.0, "Running", "Drive Not Ready", "t",
                         None, None))

    with conn.cursor() as cur:
        copy_from_rows(cur, "alarms",
                       ["ts","cleared_ts","alarm_def_id","equipment_id","sensor_id",
                        "severity","priority","message","trigger_value","state_from","state_to",
                        "acknowledged","acknowledged_by","acknowledged_at"],
                       rows)
    conn.commit()
    print(f"  ✓ {len(rows):,} alarms written")


def generate_events(conn, users, equipment_by_id):
    """Audit trail: operator commands, setpoint changes, logins."""
    rows = []
    user_ids = [u["user_id"] for u in users]
    equip_ids = list(equipment_by_id.keys())

    # ~300 random events over 14 days (realistic for this plant scale)
    for _ in range(300):
        ts = START_TS + timedelta(seconds=random.randint(0, int((END_TS-START_TS).total_seconds())))
        kind = random.choices(
            ["Controls", "Parameters", "Setpoints", "General"],
            weights=[3, 3, 2, 1])[0]
        equip_id = random.choice(equip_ids) if kind != "General" else None
        user_id  = random.choice(user_ids)

        if kind == "Controls":
            cmd = random.choice(["Start", "Stop", "Select", "Reset", "Acknowledge"])
            msg = f"Command: Value: {cmd}"
            old, new = None, cmd
        elif kind == "Parameters":
            param = random.choice(["Auto", "Manual", "Start", "Stop", "Local"])
            msg = f"Parameter: {param}  Value: 0 -> 1"
            old, new = "0", "1"
        elif kind == "Setpoints":
            val = round(random.uniform(20, 100), 1)
            msg = f"Setpoint change: {val}"
            old, new = None, str(val)
        else:
            u = next(u for u in users if u["user_id"] == user_id)
            action = random.choice(["logged in", "logged out"])
            msg = f"User '{u['username']}' {action} on client 'ECS-HMI-01'"
            old, new = None, None

        rows.append((
            ts.isoformat(), kind, equip_id, None, user_id,
            "info", msg, old, new, "SCADA"
        ))

    with conn.cursor() as cur:
        copy_from_rows(cur, "events",
                       ["ts","category","equipment_id","sensor_id","user_id",
                        "severity","message","old_value","new_value","source"],
                       rows)
    conn.commit()
    print(f"  ✓ {len(rows):,} events written")


def generate_maintenance(conn, equipment_by_id, users):
    rows = []
    techs = [u for u in users if u["role_code"] in ("technician","supervisor")]
    admin = next((u for u in users if u["role_code"] == "admin"), users[0])
    # One completed preventive per equipment + 2-3 corrective/predictive
    for eid, e in equipment_by_id.items():
        planned = END_TS - timedelta(days=random.randint(90, 180))
        actual_s = planned + timedelta(hours=random.randint(-8, 12))
        actual_e = actual_s + timedelta(hours=random.randint(2, 8))
        rows.append((
            eid, "preventive", "normal",
            f"Quarterly preventive check - {e['name']}",
            "Scheduled inspection: lubrication, vibration analysis, alignment check.",
            "completed",
            admin["user_id"], random.choice(techs)["user_id"] if techs else admin["user_id"],
            None, planned.isoformat(), (planned+timedelta(hours=6)).isoformat(),
            actual_s.isoformat(), actual_e.isoformat(),
            round(random.uniform(800, 4500), 2),
            "Bearing grease, alignment shims", "OK"))

    # Corrective triggered by the winding overheat fault
    over = next((e for e in equipment_by_id.values() if e["tag_code"] == "340G_SP_12"), None)
    if over:
        ts_trip = START_TS + timedelta(days=10.2)
        rows.append((
            over["equipment_id"], "corrective", "urgent",
            "Winding overheat - rewind inspection",
            "Motor tripped on thermal protection. Check winding insulation, bearings, cooling.",
            "completed",
            admin["user_id"], random.choice(techs)["user_id"] if techs else admin["user_id"],
            None, ts_trip.isoformat(), (ts_trip+timedelta(hours=6)).isoformat(),
            (ts_trip+timedelta(minutes=20)).isoformat(),
            (ts_trip+timedelta(hours=5)).isoformat(),
            12500.00,
            "Motor rewind, thermistor replacement", "Restored to service"))

    # Predictive (bearing fault on 310A_VP_01S - open, driven by XGBoost)
    br = next((e for e in equipment_by_id.values() if e["tag_code"] == "310A_VP_01S"), None)
    if br:
        rows.append((
            br["equipment_id"], "predictive", "high",
            "Predicted bearing failure within 7 days",
            "XGBoost model predicted bearing failure (prob=0.86). Order bearings, schedule outage.",
            "scheduled",
            admin["user_id"], random.choice(techs)["user_id"] if techs else admin["user_id"],
            None, (END_TS+timedelta(days=3)).isoformat(), (END_TS+timedelta(days=3, hours=8)).isoformat(),
            None, None, None,
            "Bearing 6316-C3 x2, gasket kit", None))

    with conn.cursor() as cur:
        copy_from_rows(cur, "maintenance_orders",
                       ["equipment_id","order_type","priority","title","description","status",
                        "created_by","assigned_to","triggered_by_prediction_id",
                        "planned_start","planned_end","actual_start","actual_end",
                        "cost","parts_replaced","notes"],
                       rows)
    conn.commit()
    print(f"  ✓ {len(rows)} maintenance orders written")


def generate_shifts(conn, users):
    rows = []
    operators = [u for u in users if u["role_code"] in ("technician","operator","supervisor")]
    if not operators: return
    # shift_id 1=MORNING, 2=AFTERNOON, 3=NIGHT — assumes seed inserted them in order
    shift_ids = [1, 2, 3]
    for day in range(14):
        d = (START_TS + timedelta(days=day)).date()
        for sid in shift_ids:
            # 1-2 operators per shift
            for op in random.sample(operators, k=min(2, len(operators))):
                rows.append((op["user_id"], sid, d.isoformat()))
    with conn.cursor() as cur:
        copy_from_rows(cur, "operator_shifts",
                       ["user_id","shift_id","shift_date"], rows)
    conn.commit()
    print(f"  ✓ {len(rows)} shift assignments written")


def generate_predictions(conn, sensors, equipment_by_id, models):
    m_anom = next((m for m in models if m["model_type"]=="anomaly"),    models[0])
    m_pred = next((m for m in models if m["model_type"]=="predictive"), models[0])
    m_rul  = next((m for m in models if m["model_type"]=="rul"),        models[0])

    # --- Anomaly scores: one per sensor per hour ---
    print("  • anomaly scores (hourly)")
    hours = int((END_TS - START_TS).total_seconds() // 3600)
    rows = []
    for s in sensors:
        for h in range(hours):
            ts = START_TS + timedelta(hours=h)
            # Score more negative near fault windows
            d = h / 24.0
            score = np.random.normal(0.15, 0.08)
            is_anom = False
            equip = equipment_by_id.get(s["equipment_id"])
            if equip:
                for f in FAULT_SCENARIOS:
                    if equip["tag_code"] == f["equipment_tag"]:
                        if "bursts" in f:
                            for (d0, d1) in f["bursts"]:
                                if d0 <= d <= d1:
                                    score = np.random.normal(-0.3, 0.1); is_anom = True
                        elif f["start_offset_days"] <= d <= f["end_offset_days"]:
                            progress = (d - f["start_offset_days"])/max(f["end_offset_days"]-f["start_offset_days"],0.01)
                            score = np.random.normal(0.15 - 0.5*progress, 0.1)
                            is_anom = score < -0.1
            rows.append((ts.isoformat(), s["sensor_id"], m_anom["model_id"],
                         round(float(score), 4), "t" if is_anom else "f", None))
    with conn.cursor() as cur:
        copy_from_rows(cur, "predictions_anomaly",
                       ["ts","sensor_id","model_id","anomaly_score","is_anomaly","explanation"], rows)
    conn.commit()
    print(f"  ✓ {len(rows):,} anomaly scores written")

    # --- Failure predictions: one per equipment per day ---
    rows = []
    for eid, e in equipment_by_id.items():
        for day in range(14):
            ts = START_TS + timedelta(days=day, hours=6)
            # Baseline low prob
            p7  = np.random.beta(2, 18)
            p14 = min(p7 + np.random.uniform(0.02, 0.08), 0.98)
            cls = "none"
            # Bearing fault on 310A_VP_01S ramps up
            if e["tag_code"] == "310A_VP_01S" and day >= 7:
                p7  = min(0.25 + (day-7)*0.10 + np.random.normal(0,0.03), 0.95)
                p14 = min(p7 + 0.08, 0.98)
                cls = "bearing_fault"
            # Density drift doesn't fail equipment
            if e["tag_code"] == "340G_SP_12" and 9 <= day <= 11:
                p7  = 0.72 + np.random.normal(0,0.05)
                p14 = 0.85 + np.random.normal(0,0.03)
                cls = "winding_overheat"
            rows.append((ts.isoformat(), eid, m_pred["model_id"], 7,
                         round(float(max(0,min(p7,1))),4), cls, round(float(max(0.5,min(1-abs(p7-0.5)*0.5,1))),3)))
            rows.append((ts.isoformat(), eid, m_pred["model_id"], 14,
                         round(float(max(0,min(p14,1))),4), cls, round(float(max(0.5,min(1-abs(p14-0.5)*0.5,1))),3)))
    with conn.cursor() as cur:
        copy_from_rows(cur, "predictions_failure",
                       ["ts","equipment_id","model_id","horizon_days","failure_prob","predicted_class","confidence"], rows)
    conn.commit()
    print(f"  ✓ {len(rows):,} failure predictions written")

    # --- RUL: one per equipment per day ---
    rows = []
    for eid, e in equipment_by_id.items():
        expected = float(e["expected_life_hours"] or 50000)
        used = float(e["runtime_hours"] or 0)
        for day in range(14):
            ts = START_TS + timedelta(days=day, hours=6)
            remaining = max(expected - used - day*24, 500)
            # Apply degradation for faulted equipment
            if e["tag_code"] == "310A_VP_01S" and day >= 7:
                remaining *= 1 - 0.08*(day-7)
            rul = remaining + np.random.normal(0, remaining*0.05)
            rul = max(rul, 200)
            health = max(0.05, min(1.0, rul / expected))
            rows.append((ts.isoformat(), eid, m_rul["model_id"],
                         round(float(rul),1), round(float(rul*0.92),1), round(float(rul*1.08),1),
                         round(float(health),4)))
    with conn.cursor() as cur:
        copy_from_rows(cur, "predictions_rul",
                       ["ts","equipment_id","model_id","rul_hours","rul_lower_95","rul_upper_95","health_index"], rows)
    conn.commit()
    print(f"  ✓ {len(rows):,} RUL predictions written")


# =============================================================================
# Entry point
# =============================================================================
def main():
    print(f"Connecting to {DB_URL}")
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = False

    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT sensor_id, equipment_id, tag_code, measurement, unit, "
                    "       warn_low, warn_high, alarm_low, alarm_high, range_min, range_max "
                    "FROM sensors WHERE is_active = TRUE")
        sensors = cur.fetchall()
        cur.execute("SELECT equipment_id, tag_code, name, status, expected_life_hours, runtime_hours FROM equipment")
        equipment_by_id = {r["equipment_id"]: dict(r) for r in cur.fetchall()}
        cur.execute("SELECT u.user_id, u.username, u.email, r.code AS role_code "
                    "FROM users u JOIN roles r USING (role_id)")
        users = [dict(r) for r in cur.fetchall()]
        cur.execute("SELECT alarm_def_id, sensor_id, code, severity FROM alarm_definitions")
        alarm_defs = cur.fetchall()
        cur.execute("SELECT model_id, name, model_type FROM ml_models")
        models = [dict(r) for r in cur.fetchall()]

    # Build a lookup we can also index by tag_code
    equip_by_tag = {e["tag_code"]: dict(e) for e in equipment_by_id.values()}
    for eid, e in equipment_by_id.items():
        e["tag_code"] = e["tag_code"]  # ensure key present
    # Also let sensor records carry equipment tag_code for convenience
    e_id_to_tag = {eid: e["tag_code"] for eid, e in equipment_by_id.items()}
    for s in sensors:
        s["equipment_tag"] = e_id_to_tag.get(s["equipment_id"], "")

    print(f"\nWindow: {START_TS.isoformat()}  →  {END_TS.isoformat()}")
    print(f"  {len(sensors)} sensors, {len(equipment_by_id)} equipment, {len(users)} users")

    print("\n[1/5] sensor_readings")
    generate_sensor_readings(conn, sensors, equip_by_tag)

    print("\n[2/5] alarms (derived from threshold crossings)")
    generate_alarms(conn, sensors, alarm_defs, equipment_by_id)

    print("\n[3/5] events (audit trail)")
    generate_events(conn, users, equipment_by_id)

    print("\n[4/5] maintenance_orders & operator_shifts")
    generate_maintenance(conn, equipment_by_id, users)
    generate_shifts(conn, users)

    print("\n[5/5] ML predictions (anomaly + failure + RUL)")
    generate_predictions(conn, sensors, equipment_by_id, models)

    print("\n✅ Mock data generated successfully.")
    conn.close()


if __name__ == "__main__":
    main()
