/**
 * Sensor readings endpoints - raw & aggregated time-series.
 * Designed to stay fast on TimescaleDB hypertables.
 */
'use strict';

const { query } = require('../config/db');
const { ApiError, asyncHandler } = require('../middleware/errorHandler');

/** GET /api/sensors */
const listSensors = asyncHandler(async (req, res) => {
  const { equipment, measurement } = req.query;
  const where = ['s.is_active = TRUE'];
  const params = [];
  if (equipment)   { params.push(equipment);   where.push(`s.equipment_id = $${params.length}`); }
  if (measurement) { params.push(measurement); where.push(`s.measurement = $${params.length}`); }
  const { rows } = await query(
    `SELECT s.sensor_id, s.tag_code, s.name, s.measurement, s.unit,
            s.range_min, s.range_max, s.warn_low, s.warn_high,
            s.alarm_low, s.alarm_high,
            e.tag_code AS equipment_tag, e.name AS equipment_name
     FROM sensors s
     JOIN equipment e ON e.equipment_id = s.equipment_id
     WHERE ${where.join(' AND ')}
     ORDER BY s.tag_code`,
    params
  );
  res.json(rows);
});

/** GET /api/sensors/:id */
const getSensor = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT s.*, e.tag_code AS equipment_tag, e.name AS equipment_name
     FROM sensors s
     JOIN equipment e ON e.equipment_id = s.equipment_id
     WHERE s.sensor_id = $1`,
    [req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Sensor not found');
  res.json(rows[0]);
});

/** GET /api/sensors/latest  - latest value per sensor (dashboard gauges) */
const latest = asyncHandler(async (_req, res) => {
  const { rows } = await query(
    `SELECT v.sensor_id, s.tag_code, s.name, s.measurement, s.unit,
            v.ts, v.value, v.quality, v.is_anomaly,
            s.equipment_id, e.tag_code AS equipment_tag
     FROM v_sensor_latest v
     JOIN sensors s   ON s.sensor_id   = v.sensor_id
     JOIN equipment e ON e.equipment_id = s.equipment_id`
  );
  res.json(rows);
});

/**
 * GET /api/sensors/:id/readings
 *   ?from=ISO&to=ISO&bucket=1s|10s|1m|5m|1h   (default: last 1h raw)
 *   ?limit=5000
 * Returns {sensor, points:[{ts,value,min,max,std}]}
 */
const readings = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const to     = req.query.to   ? new Date(req.query.to)   : new Date();
  const from   = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - 60 * 60 * 1000);
  const bucket = req.query.bucket || 'raw';
  const limit  = Math.min(parseInt(req.query.limit, 10) || 5000, 50000);

  if (isNaN(from) || isNaN(to) || from >= to) throw new ApiError(400, 'Invalid time range');

  const { rows: meta } = await query(
    'SELECT sensor_id, tag_code, name, unit FROM sensors WHERE sensor_id = $1', [id]);
  if (!meta[0]) throw new ApiError(404, 'Sensor not found');

  let points;
  if (bucket === 'raw') {
    const r = await query(
      `SELECT ts, value, is_anomaly
       FROM sensor_readings
       WHERE sensor_id = $1 AND ts BETWEEN $2 AND $3
       ORDER BY ts ASC
       LIMIT $4`,
      [id, from, to, limit]
    );
    points = r.rows;
  } else {
    const r = await query(
      `SELECT time_bucket($4::interval, ts) AS bucket,
              AVG(value) AS value, MIN(value) AS min, MAX(value) AS max,
              STDDEV(value) AS std, COUNT(*) AS n
       FROM sensor_readings
       WHERE sensor_id = $1 AND ts BETWEEN $2 AND $3
       GROUP BY bucket
       ORDER BY bucket ASC
       LIMIT $5`,
      [id, from, to, bucket, limit]
    );
    points = r.rows.map(r => ({ ts: r.bucket, value: Number(r.value),
      min: Number(r.min), max: Number(r.max), std: r.std ? Number(r.std) : 0, n: Number(r.n) }));
  }

  res.json({ sensor: meta[0], from, to, bucket, points });
});

/**
 * POST /api/sensors/:id/readings  - ingest a single reading (used by SCADA bridge).
 * Admin/operator only. Body: { value, ts?, quality? }
 */
const ingest = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { value, ts, quality = 192 } = req.body || {};
  if (typeof value !== 'number') throw new ApiError(400, 'value must be a number');
  const when = ts ? new Date(ts) : new Date();
  if (isNaN(when)) throw new ApiError(400, 'invalid ts');
  await query(
    `INSERT INTO sensor_readings (ts, sensor_id, value, quality)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [when, id, value, quality]
  );
  res.status(201).json({ ok: true });
});

module.exports = { listSensors, getSensor, latest, readings, ingest };
