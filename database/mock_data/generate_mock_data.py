#!/usr/bin/env python3
"""
PHOSWATCH - Mock data generator
================================

Generates realistic time-series + event data for the Benguerir phosphate
washing / flotation plant monitoring system.

Produces:
  * sensor_readings      : 14 days @ 10-second resolution for all 36 sensors
  * alarms               : alarm events derived from threshold crossings
  * events               : audit trail (logins, commands, setpoint changes)
  * maintenance_orders   : preventive + corrective + predictive work orders
  * operator_shifts      : 14 days of 3x8 shift rota
  * predictions_anomaly  : Isolation-Forest scores (dense during faults)
  * predictions_failure  : XGBoost 7/14-day failure probabilities
  * predictions_rul      : LSTM remaining-useful-life with confidence bounds

Realistic FAULT SCENARIOS injected (with ground-truth labels):
  1. Bearing degradation    -> pump 310A_VP_01S     (slow drift days 5..14)
  2. Winding overheat       -> agitator 310A_AG_2410 (spike day 8)
  3. Cavitation             -> slurry pump 320A_SP_07 (day 6..7)
  4. Froth level instability-> flotation cell 320A_FY_01 (day 9)
  5. Belt slip (patinage)   -> conveyor 410A_CONV_B5 (days 11..13)
  6. Stacker translation    -> stacker 410A_STKR_01  (day 4, runtime fault)

Usage:
  pip install -r requirements.txt
  # Then from the host, with the 'database' container running:
  python generate_mock_data.py

Connects to the DB via DATABASE_URL or default localhost:5432.
Uses psycopg2 COPY for fast bulk insert (~30-60 s total on a laptop).
"""

from __future__ import annotations
import os, io, sys, math, random
from datetime import datetime, timedelta, timezone
from dataclasses import dataclass

import numpy as np
import psycopg2
from psycopg2.extras import execute_values

# -----------------------------------------------------------------------------
# Config
# -----------------------------------------------------------------------------
DB_URL       = os.getenv(
    "DATABASE_URL",
    "postgresql://phoswatch_user:phoswatch_pass@localhost:5432/phoswatch_db",
)
DAYS         = 14            # history length
SAMPLE_SEC   = 10            # sensor sampling period
SEED         = 42
END_TS       = datetime.now(timezone.utc).replace(microsecond=0, second=0)
START_TS     = END_TS - timedelta(days=DAYS)

rng = np.random.default_rng(SEED)
random.seed(SEED)

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
@dataclass
class Sensor:
    sensor_id: int
    equipment_id: int
    equipment_tag: str
    tag_code: str
    measurement: str
    unit: str
    range_min: float | None
    range_max: float | None
    warn_low: float | None
    warn_high: float | None
    alarm_low: float | None
    alarm_high: float | None


def connect():
    print(f"[db] connecting to {DB_URL.split('@')[-1]}")
    return psycopg2.connect(DB_URL)


def fetch_sensors(cur) -> list[Sensor]:
    cur.execute("""
        SELECT s.sensor_id, s.equipment_id, e.tag_code, s.tag_code,
               s.measurement, s.unit,
               s.range_min, s.range_max,
               s.warn_low, s.warn_high, s.alarm_low, s.alarm_high
        FROM sensors s
        JOIN equipment e ON e.equipment_id = s.equipment_id
        ORDER BY s.sensor_id
    """)
    return [Sensor(*r) for r in cur.fetchall()]


def copy_rows(cur, table: str, columns: list[str], rows_iter):
    """Bulk COPY via in-memory TSV."""
    buf = io.StringIO()
    n = 0
    for row in rows_iter:
        buf.write("\t".join("\\N" if v is None else str(v) for v in row))
        buf.write("\n")
        n += 1
    buf.seek(0)
    cur.copy_expert(
        f"COPY {table} ({','.join(columns)}) FROM STDIN WITH (FORMAT text, NULL '\\N')",
        buf,
    )
    return n


# -----------------------------------------------------------------------------
# Sensor dynamics
# -----------------------------------------------------------------------------
def baseline(measurement: str, s: Sensor) -> float:
    """Pick a sensible normal-operation baseline inside the healthy band."""
    lo = s.warn_low  if s.warn_low  is not None else (s.range_min or 0)
    hi = s.warn_high if s.warn_high is not None else (s.range_max or 100)
    # Aim for ~60% of the safe band
    if measurement == "vibration":   return 2.0
    if measurement == "temperature": return lo + 0.35 * (hi - lo) if lo else 0.55 * hi
    if measurement == "pressure":    return 0.5 * (lo + hi) if lo else 0.6 * hi
    if measurement == "flow":        return 0.75 * hi
    if measurement == "level":       return 0.5 * (lo + hi) if lo else 60
    if measurement == "current":     return 0.65 * hi
    if measurement == "speed":       return 0.85 * hi if hi else 1500
    if measurement == "position":    return 0.0
    if measurement == "ph":          return 9.0
    if measurement == "density":     return 0.5 * ((lo or 1100) + (hi or 1600))
    if measurement == "tension":     return 0.6 * (hi or 200)
    return 0.5 * ((lo or 0) + (hi or 1))


def noise_scale(measurement: str, s: Sensor) -> float:
    span = (s.range_max or 100) - (s.range_min or 0)
    return {
        "vibration": 0.10,
        "temperature": 0.005 * span,
        "pressure": 0.01 * span,
        "flow": 0.01 * span,
        "level": 0.015 * span,
        "current": 0.008 * span,
        "speed": 0.01 * span,
        "position": 0.2,
        "ph": 0.04,
        "density": 0.006 * span,
        "tension": 0.01 * span,
    }.get(measurement, 0.01 * span)


def diurnal(t_frac: float, measurement: str) -> float:
    """Small daily load cycle. t_frac is hours since start."""
    amp = {
        "flow": 0.06, "current": 0.04, "temperature": 0.03,
        "level": 0.05, "speed": 0.02,
    }.get(measurement, 0.02)
    return amp * math.sin(2 * math.pi * (t_frac / 24.0))


# -----------------------------------------------------------------------------
# Fault scenarios.  Each returns (delta_value, is_anomaly_flag).
# idx is the sample index (0..N-1), N = DAYS*86400/SAMPLE_SEC.
# -----------------------------------------------------------------------------
N_SAMPLES = DAYS * 86400 // SAMPLE_SEC      # 120_960
DAY       = 86400 // SAMPLE_SEC             # 8640 samples per day


def fault_delta(sensor: Sensor, idx_arr: np.ndarray, base: float) -> tuple[np.ndarray, np.ndarray]:
    """Return (delta_array, anomaly_mask) for a sensor given all time indices."""
    delta = np.zeros_like(idx_arr, dtype=float)
    anomaly = np.zeros_like(idx_arr, dtype=bool)

    tag = sensor.tag_code
    etag = sensor.equipment_tag

    # --- 1. Bearing degradation on pump 310A_VP_01S (days 5..14) -------------
    if etag == "310A_VP_01S":
        mask = idx_arr >= 5 * DAY
        progress = (idx_arr - 5 * DAY) / (9 * DAY)    # 0 -> 1 over 9 days
        progress = np.clip(progress, 0, 1)
        if tag.startswith("310A_VI_01S"):             # vibration: 2.0 -> 5.5
            bump = 3.5 * progress ** 1.3
            delta[mask] += bump[mask]
            anomaly |= (mask & (bump > 1.0))
        if tag in ("310A_TI_5301_D", "310A_TI_5301_E"):   # bearing temps
            bump = 28.0 * progress ** 1.2
            delta[mask] += bump[mask]
            anomaly |= (mask & (bump > 10.0))

    # --- 2. Winding overheat on agitator 310A_AG_2410 (day 8, 15 min spike)
    if etag == "310A_AG_2410":
        start = 8 * DAY + int(3600 * 10 / SAMPLE_SEC)     # day 8 @ 10:00
        end   = start + int(15 * 60 / SAMPLE_SEC)         # +15 min
        win   = (idx_arr >= start) & (idx_arr < end)
        if tag == "310A_TI_2410_W":
            bump = 50.0 * np.exp(-((idx_arr - (start + end) / 2) ** 2) /
                                 (2 * (60.0) ** 2))
            delta += bump
            anomaly |= (bump > 15.0)
        if tag == "310A_II_2410":
            delta[win] += 45
            anomaly |= win

    # --- 3. Cavitation on slurry pump 320A_SP_07 (days 6..7, oscillating) -----
    if etag == "320A_SP_07":
        start = 6 * DAY
        end   = 7 * DAY + DAY // 2
        win   = (idx_arr >= start) & (idx_arr < end)
        if tag == "320A_VI_SP_07":
            # ragged amplitude-modulated bump
            osc = 3.0 * np.abs(np.sin(2 * math.pi * idx_arr / 17))
            delta[win] += osc[win]
            anomaly |= (win & (osc > 1.5))
        if tag == "320A_PI_SP_07":
            dip = -3.0 * np.abs(np.sin(2 * math.pi * idx_arr / 23))
            delta[win] += dip[win]

    # --- 4. Froth level instability on cell 320A_FY_01 (day 9, ~2 h) ----------
    if etag == "320A_FY_01":
        start = 9 * DAY + int(3600 * 14 / SAMPLE_SEC)
        end   = start + int(2 * 3600 / SAMPLE_SEC)
        win   = (idx_arr >= start) & (idx_arr < end)
        if tag == "320A_LI_01_A":
            swing = 35.0 * np.sin(2 * math.pi * (idx_arr - start) / 300)
            delta[win] += swing[win]
            anomaly |= win

    # --- 5. Belt slip on conveyor 410A_CONV_B5 (days 11..13) ------------------
    if etag == "410A_CONV_B5":
        start = 11 * DAY
        end   = 13 * DAY
        win   = (idx_arr >= start) & (idx_arr < end)
        progress = (idx_arr - start) / (2 * DAY)
        progress = np.clip(progress, 0, 1)
        if tag == "410A_SI_B5":     # speed drops
            delta[win] -= 1.2 * progress[win]
            anomaly |= (win & (progress > 0.3))
        if tag == "410A_TI_B5_M":   # motor temp creeps up
            delta[win] += 25 * progress[win]

    # --- 6. Stacker translation runtime fault (day 4, short stop) -------------
    if etag == "410A_STKR_01":
        start = 4 * DAY + int(3600 * 16 / SAMPLE_SEC)
        end   = start + int(30 * 60 / SAMPLE_SEC)
        win   = (idx_arr >= start) & (idx_arr < end)
        if tag == "410A_II_STKR":
            delta[win] = -base        # current collapses to ~0
            anomaly |= win

    return delta, anomaly


# -----------------------------------------------------------------------------
# Main generators
# -----------------------------------------------------------------------------
def gen_sensor_readings(sensors: list[Sensor], cur):
    """Generate N_SAMPLES values per sensor and bulk-COPY them."""
    print(f"[gen] sensor_readings: {len(sensors)} sensors x {N_SAMPLES} samples "
          f"= {len(sensors)*N_SAMPLES:,} rows")

    idx_arr = np.arange(N_SAMPLES, dtype=np.int64)
    ts_arr  = np.array([START_TS + timedelta(seconds=int(i) * SAMPLE_SEC)
                        for i in idx_arr])   # built once, reused via formatting

    # Pre-format timestamps as ISO strings (faster than per-row datetime in loop)
    ts_strs = [t.isoformat(sep=' ') for t in ts_arr]

    total_rows = 0
    for s in sensors:
        base  = baseline(s.measurement, s)
        sigma = noise_scale(s.measurement, s)
        # Smooth random walk (integrated gaussian) + diurnal + gaussian noise
        walk  = np.cumsum(rng.normal(0, sigma * 0.15, N_SAMPLES)) * 0.02
        # Clip walk to a narrow band so it doesn't drift too far
        walk  = np.clip(walk, -3 * sigma, 3 * sigma)
        hours = idx_arr * SAMPLE_SEC / 3600.0
        diur  = base * np.array([diurnal(h, s.measurement) for h in hours])
        noise = rng.normal(0, sigma, N_SAMPLES)

        values = base + walk + diur + noise

        # Inject faults
        fdelta, anomaly = fault_delta(s, idx_arr, base)
        values += fdelta

        # Clamp to physical range
        if s.range_min is not None:
            values = np.maximum(values, float(s.range_min))
        if s.range_max is not None:
            values = np.minimum(values, float(s.range_max))

        # Build rows (ts, sensor_id, value, quality, is_anomaly)
        def row_gen():
            for i in range(N_SAMPLES):
                yield (ts_strs[i], s.sensor_id, f"{values[i]:.4f}",
                       192, "t" if anomaly[i] else "f")

        n = copy_rows(cur, "sensor_readings",
                      ["ts", "sensor_id", "value", "quality", "is_anomaly"],
                      row_gen())
        total_rows += n
        print(f"  - {s.tag_code:<22s} ({s.measurement:<12s}) -> {n:,} rows")

    print(f"[gen] sensor_readings DONE: {total_rows:,} rows")


def gen_alarms_and_events(sensors: list[Sensor], cur):
    """Derive alarm records from threshold crossings + synthesize operator events."""
    print("[gen] alarms + events")

    # --- Operator events (audit trail) --------------------------------------
    usernames = [r[0] for r in
                 cur.execute("SELECT user_id FROM users ORDER BY user_id")
                 or cur.fetchall()] if False else None
    cur.execute("SELECT user_id FROM users ORDER BY user_id")
    user_ids = [r[0] for r in cur.fetchall()]

    cur.execute("SELECT equipment_id, tag_code FROM equipment ORDER BY equipment_id")
    equipment = cur.fetchall()

    events_rows = []
    # A couple of hundred operator events spread across 14 days
    for _ in range(380):
        t = START_TS + timedelta(seconds=random.randint(0, DAYS * 86400))
        eq = random.choice(equipment)
        cat = random.choices(
            ["Controls", "Parameters", "Setpoints", "General Category"],
            weights=[35, 30, 25, 10],
        )[0]
        if cat == "Controls":
            msg = f"Command: Value: {random.choice(['Start','Stop','Select','Reset'])}"
        elif cat == "Parameters":
            msg = (f"Parameter: {random.choice(['Auto','Start','Manual','Enable'])}  "
                   f"Value: 0 -> 1")
        elif cat == "Setpoints":
            msg = f"Setpoint change: {random.choice([25, 50, 75, 100, 120])}"
        else:
            u = random.choice(["FlsAdmin", "othmane", "supervisor1", "tech_a"])
            msg = f"User '{u}' logged in on client 'ECS4865CLT{random.randint(1,5):02d}'."
        events_rows.append((
            t.isoformat(sep=' '),
            cat,
            eq[0],              # equipment_id
            None,               # sensor_id
            random.choice(user_ids) if user_ids else None,
            "Information",
            msg,
            None, None,
            "SCADA" if cat != "General Category" else "HMI",
        ))

    n_ev = copy_rows(cur, "events",
        ["ts","category","equipment_id","sensor_id","user_id",
         "severity","message","old_value","new_value","source"],
        iter(events_rows))
    print(f"  - events: {n_ev:,} rows")

    # --- Alarms from threshold crossings ------------------------------------
    # Re-read the sensor_readings we just wrote and detect state transitions
    # against the sensor's warn/alarm limits.
    cur.execute("""
        SELECT a.alarm_def_id, a.sensor_id, a.code, a.severity, a.priority,
               COALESCE(a.message_en, a.message_fr), a.threshold,
               s.equipment_id
        FROM alarm_definitions a
        JOIN sensors s ON s.sensor_id = a.sensor_id
        WHERE a.is_enabled = TRUE
    """)
    defs = cur.fetchall()

    # Build per-sensor list of definitions
    defs_by_sensor = {}
    for d in defs:
        defs_by_sensor.setdefault(d[1], []).append(d)

    alarm_rows = []
    # Pull readings per sensor and detect threshold crossings
    for s in sensors:
        if s.sensor_id not in defs_by_sensor:
            continue
        cur.execute("""SELECT ts, value FROM sensor_readings
                       WHERE sensor_id = %s ORDER BY ts""", (s.sensor_id,))
        series = cur.fetchall()
        if not series:
            continue

        for (def_id, _, code, sev, prio, msg, thr, eq_id) in defs_by_sensor[s.sensor_id]:
            if thr is None:
                continue
            is_high = code.startswith("H")
            in_alarm = False
            alarm_start = None
            for (ts, v) in series:
                v = float(v)
                breached = (v >= float(thr)) if is_high else (v <= float(thr))
                if breached and not in_alarm:
                    in_alarm = True
                    alarm_start = ts
                    start_val = v
                elif not breached and in_alarm:
                    in_alarm = False
                    # Only keep alarms with a noticeable duration or severity
                    dur = (ts - alarm_start).total_seconds()
                    if dur >= 30 or sev in ("fatal", "urgent"):
                        alarm_rows.append((
                            alarm_start.isoformat(sep=' '),
                            ts.isoformat(sep=' '),
                            def_id, eq_id, s.sensor_id,
                            sev, prio, msg, f"{start_val:.3f}",
                            "Normal",
                            "H1 Warning" if code == "H1_WARNING" else
                            "H2 Alarm"   if code == "H2_ALARM"   else
                            "L1 Warning" if code == "L1_WARNING" else
                            "L2 Alarm"   if code == "L2_ALARM"   else code,
                            "f", None, None,
                        ))

    n_al = copy_rows(cur, "alarms",
        ["ts","cleared_ts","alarm_def_id","equipment_id","sensor_id",
         "severity","priority","message","trigger_value","state_from","state_to",
         "acknowledged","acknowledged_by","acknowledged_at"],
        iter(alarm_rows))
    print(f"  - alarms: {n_al:,} rows")


def gen_maintenance(cur):
    print("[gen] maintenance_orders")
    cur.execute("SELECT equipment_id, tag_code FROM equipment ORDER BY equipment_id")
    equipment = cur.fetchall()
    cur.execute("SELECT user_id FROM users ORDER BY user_id")
    uids = [r[0] for r in cur.fetchall()]

    rows = []

    # 8 preventive orders (one per equipment) — scheduled historically + future
    for eq_id, tag in equipment:
        d0 = START_TS + timedelta(days=random.randint(1, DAYS - 2))
        rows.append((
            eq_id, "preventive", "normal",
            f"Quarterly preventive check — {tag}",
            "Scheduled routine inspection: lubrication, alignment check, vibration reading, "
            "electrical contacts, filter change.",
            random.choice(["completed","scheduled","open"]),
            random.choice(uids), random.choice(uids), None,
            d0.isoformat(sep=' '),
            (d0 + timedelta(hours=4)).isoformat(sep=' '),
            None, None, 3500.00,
            "Lubricant, air filter, gasket kit",
            None,
        ))

    # 3 corrective orders for the injected faults
    corr = [
        ("310A_VP_01S", "Pump 01S bearing replacement",
         "High vibration and bearing temperature trend detected by anomaly "
         "detection model. Replace DE bearing, perform alignment.",
         "urgent"),
        ("410A_CONV_B5", "Belt B5 tension & slip investigation",
         "Belt speed dropping under constant motor current — classic slip "
         "signature. Inspect drive pulley, take-up, belt wear.",
         "high"),
        ("320A_SP_07", "Pump 07 cavitation check",
         "Vibration oscillation + pressure dips suggest cavitation. Check suction "
         "line, NPSH, impeller wear.",
         "high"),
    ]
    for tag, title, desc, pri in corr:
        cur.execute("SELECT equipment_id FROM equipment WHERE tag_code=%s", (tag,))
        eq = cur.fetchone()
        if not eq:
            continue
        d0 = START_TS + timedelta(days=random.randint(6, 13))
        rows.append((
            eq[0], "corrective", pri, title, desc, "in_progress",
            random.choice(uids), random.choice(uids), None,
            d0.isoformat(sep=' '),
            (d0 + timedelta(hours=6)).isoformat(sep=' '),
            d0.isoformat(sep=' '), None,
            12000.00,
            "Bearing, seal kit, coupling" if "bearing" in title.lower()
            else "Belt section, take-up pulley",
            "Triggered by anomaly detection",
        ))

    # 2 predictive orders (triggered by RUL model)
    for tag, title in [
        ("310A_VP_01S", "Predictive: bearing replacement in 7 days"),
        ("410A_CONV_B5", "Predictive: belt inspection before shift change")
    ]:
        cur.execute("SELECT equipment_id FROM equipment WHERE tag_code=%s", (tag,))
        eq = cur.fetchone()
        if not eq:
            continue
        d0 = END_TS + timedelta(days=random.randint(1, 5))
        rows.append((
            eq[0], "predictive", "high", title,
            "Auto-created from ML RUL prediction (health index < 0.35).",
            "scheduled",
            random.choice(uids), random.choice(uids), None,
            d0.isoformat(sep=' '),
            (d0 + timedelta(hours=4)).isoformat(sep=' '),
            None, None, None, None,
            "Generated by predictions_rul",
        ))

    n = copy_rows(cur, "maintenance_orders",
        ["equipment_id","order_type","priority","title","description","status",
         "created_by","assigned_to","triggered_by_prediction_id",
         "planned_start","planned_end","actual_start","actual_end",
         "cost","parts_replaced","notes"],
        iter(rows))
    print(f"  - maintenance_orders: {n:,} rows")


def gen_operator_shifts(cur):
    print("[gen] operator_shifts")
    cur.execute("SELECT user_id FROM users WHERE is_active=TRUE ORDER BY user_id")
    uids = [r[0] for r in cur.fetchall()]
    cur.execute("SELECT shift_id FROM shifts ORDER BY shift_id")
    sids = [r[0] for r in cur.fetchall()]
    if not uids or not sids:
        print("  (no users or shifts defined — skipping)")
        return

    rows = []
    day0 = (START_TS.date())
    for d in range(DAYS + 3):            # cover a bit past today for planning view
        date = day0 + timedelta(days=d)
        # Rotate users across shifts
        for i, sid in enumerate(sids):
            u = uids[(d + i) % len(uids)]
            rows.append((u, sid, date.isoformat()))
    n = copy_rows(cur, "operator_shifts",
                  ["user_id","shift_id","shift_date"], iter(rows))
    print(f"  - operator_shifts: {n:,} rows")


def gen_predictions(cur):
    print("[gen] predictions_anomaly / _failure / _rul")

    cur.execute("SELECT model_id, name, model_type FROM ml_models")
    models = {m[2]: m[0] for m in cur.fetchall()}

    cur.execute("SELECT equipment_id, tag_code FROM equipment ORDER BY equipment_id")
    equipment = cur.fetchall()
    cur.execute("SELECT sensor_id, equipment_id FROM sensors")
    sensors = cur.fetchall()

    # --- Anomaly scores (one per hour per sensor, dense during fault windows)
    an_rows = []
    hours = DAYS * 24
    for ts_i in range(hours):
        t = START_TS + timedelta(hours=ts_i)
        for (sid, eid) in sensors:
            # Base score ~ slightly negative noise
            score = rng.normal(0.15, 0.05)
            # Boost anomaly during known fault windows for specific equipment
            boost = 0.0
            if eid == 1:                   # 310A_VP_01S
                if ts_i >= 5*24:
                    boost = min(1.0, (ts_i - 5*24) / (9*24)) * 0.5
            if eid == 2 and 8*24 <= ts_i < 8*24+1:    # AG_2410 @ day8
                boost = 0.6
            if eid == 4 and 6*24 <= ts_i < 7*24+12:    # SP_07 cavitation
                boost = 0.4
            if eid == 3 and ts_i == 9*24 + 14:        # FY_01 level
                boost = 0.5
            if eid == 7 and 11*24 <= ts_i < 13*24:     # CONV_B5
                boost = 0.45
            score -= boost
            is_an = score < -0.05
            if 'anomaly' in models:
                an_rows.append((t.isoformat(sep=' '), sid, models['anomaly'],
                                f"{score:.4f}", "t" if is_an else "f", None))
    if an_rows:
        n = copy_rows(cur, "predictions_anomaly",
            ["ts","sensor_id","model_id","anomaly_score","is_anomaly","explanation"],
            iter(an_rows))
        print(f"  - predictions_anomaly: {n:,} rows")

    # --- Failure probability (daily per equipment, 7-day and 14-day horizons)
    fail_rows = []
    classes = ["bearing_fault","winding_overheat","cavitation","belt_slip","misalignment"]
    for d in range(DAYS):
        t = START_TS + timedelta(days=d, hours=6)       # daily at 06:00
        for (eid, tag) in equipment:
            for horizon in (7, 14):
                base = 0.05
                if tag == "310A_VP_01S":
                    base = 0.05 + 0.08 * d              # climbs over time
                if tag == "410A_CONV_B5" and d >= 10:
                    base = 0.35 + 0.1 * (d - 10)
                if tag == "320A_SP_07"  and 5 <= d <= 8:
                    base = 0.25
                prob = min(0.98, base + 0.02 * horizon / 7)
                cls  = (
                    "bearing_fault"   if tag == "310A_VP_01S" else
                    "belt_slip"       if tag == "410A_CONV_B5" else
                    "cavitation"      if tag == "320A_SP_07"  else
                    random.choice(classes)
                )
                if 'predictive' in models:
                    fail_rows.append((
                        t.isoformat(sep=' '), eid, models['predictive'],
                        horizon, f"{prob:.4f}", cls, f"{min(0.95, 0.6+prob*0.3):.3f}"
                    ))
    if fail_rows:
        n = copy_rows(cur, "predictions_failure",
            ["ts","equipment_id","model_id","horizon_days","failure_prob",
             "predicted_class","confidence"],
            iter(fail_rows))
        print(f"  - predictions_failure: {n:,} rows")

    # --- RUL (Remaining Useful Life) — one reading per equipment per 6 hours
    rul_rows = []
    for step in range(DAYS * 4):   # every 6h
        t = START_TS + timedelta(hours=step * 6)
        for (eid, tag) in equipment:
            # Simple degradation: 1.0 -> toward 0 for the two "sick" equipments
            if tag == "310A_VP_01S":
                hi = max(0.15, 1.0 - (step / (DAYS * 4)) * 0.85)
            elif tag == "410A_CONV_B5":
                hi = max(0.25, 1.0 - (step / (DAYS * 4)) * 0.7 if step >= 44 else 1.0)
            else:
                hi = rng.uniform(0.75, 0.98)
            rul = max(24.0, 8000 * hi + rng.normal(0, 300))
            if 'rul' in models:
                rul_rows.append((
                    t.isoformat(sep=' '), eid, models['rul'],
                    f"{rul:.1f}", f"{max(0, rul - 500):.1f}", f"{rul + 500:.1f}",
                    f"{hi:.4f}",
                ))
    if rul_rows:
        n = copy_rows(cur, "predictions_rul",
            ["ts","equipment_id","model_id","rul_hours",
             "rul_lower_95","rul_upper_95","health_index"],
            iter(rul_rows))
        print(f"  - predictions_rul: {n:,} rows")


# -----------------------------------------------------------------------------
# Orchestration
# -----------------------------------------------------------------------------
def main():
    print(f"[run] PHOSWATCH mock-data generator")
    print(f"      window  : {START_TS}  ->  {END_TS}  ({DAYS} days)")
    print(f"      sampling: {SAMPLE_SEC}s  -> {N_SAMPLES:,} samples/sensor")

    with connect() as conn:
        with conn.cursor() as cur:
            sensors = fetch_sensors(cur)
            if not sensors:
                print("[ERR] no sensors in DB — run init.sql + seed.sql first.")
                sys.exit(1)
            print(f"[db] found {len(sensors)} sensors across "
                  f"{len({s.equipment_id for s in sensors})} equipment pieces")

            # Wipe any previous mock rows so the generator is re-runnable
            for t in ("sensor_readings", "alarms", "events",
                      "predictions_anomaly", "predictions_failure",
                      "predictions_rul", "maintenance_orders",
                      "operator_shifts"):
                cur.execute(f"TRUNCATE {t} RESTART IDENTITY CASCADE")
            print("[db] cleared existing mock rows")

            gen_sensor_readings(sensors, cur)
            conn.commit()
            gen_alarms_and_events(sensors, cur)
            conn.commit()
            gen_maintenance(cur)
            gen_operator_shifts(cur)
            gen_predictions(cur)
            conn.commit()

            print("[db] refreshing continuous aggregate sensor_readings_1m ...")
            cur.execute("CALL refresh_continuous_aggregate('sensor_readings_1m', NULL, NULL)")
            conn.commit()

    print("[ok] done.")


if __name__ == "__main__":
    main()
