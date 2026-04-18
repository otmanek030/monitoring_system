/**
 * Synthetic live data generator.
 *
 * Produces realistic sensor signals when no real SCADA is connected,
 * writes them to sensor_readings, runs the alarm engine on each value,
 * and broadcasts 'reading' / 'alarm:*' events through the provided emitter.
 *
 * The physics is intentionally simple: each sensor has a baseline around
 * 60 % of its operating range with slow sinusoidal drift, small noise,
 * and a 0.5 % chance of a spike that will trigger alarms -- perfect for
 * demoing the whole stack.
 */
'use strict';

const env = require('../config/env');
const logger = require('../config/logger');
const dbSvc = require('./dbService');
const alarmEngine = require('./alarmEngine');

let sensorsCache = [];
let timer = null;
let broadcaster = null;
let tick = 0;

function baseline(s) {
  const min = Number(s.range_min ?? 0);
  const max = Number(s.range_max ?? 100);
  // Target around 55-65% of span
  return min + (max - min) * 0.6;
}

function generateValue(s) {
  const base = baseline(s);
  const span = Math.max(1, (Number(s.range_max ?? 100) - Number(s.range_min ?? 0)));
  const phase = (tick % 600) / 600 * Math.PI * 2;     // slow 10-min drift
  const drift = Math.sin(phase + s.sensor_id) * span * 0.05;
  const noise = (Math.random() - 0.5) * span * 0.02;
  // Occasional spike (0.5%) to exercise alarm engine and anomaly model
  const spike = Math.random() < 0.005 ? (Math.random() - 0.5) * span * 0.6 : 0;
  let v = base + drift + noise + spike;

  // Keep inside the sensor's physical range (don't go insane)
  v = Math.max(Number(s.range_min ?? -1e9), Math.min(Number(s.range_max ?? 1e9), v));
  // Round to a sensible precision
  return Math.round(v * 1000) / 1000;
}

async function step() {
  tick++;
  const now = new Date();
  const readings = [];
  const events = [];

  for (const s of sensorsCache) {
    if (s.equipment_status === 'stopped' || s.equipment_status === 'maintenance') continue;
    const value = generateValue(s);
    readings.push({ sensor_id: s.sensor_id, value, ts: now, quality: 192 });

    // Fire alarm engine (async but short)
    try {
      const ev = await alarmEngine.evaluate(s, value, now);
      for (const e of ev) events.push(e);
    } catch (err) {
      logger.error('alarm engine error', { err: err.message });
    }

    // Broadcast on WebSocket room 'equipment:<id>' and global 'readings'
    if (broadcaster) {
      broadcaster.emit('reading', {
        sensor_id: s.sensor_id, equipment_id: s.equipment_id,
        tag_code: s.tag_code, value, unit: s.unit, ts: now,
      });
    }
  }

  try {
    await dbSvc.insertReadings(readings);
  } catch (err) {
    logger.error('insert readings failed', { err: err.message });
  }

  if (broadcaster) {
    for (const e of events) {
      if (e.type === 'new')     broadcaster.emit('alarm:new', e.alarm);
      if (e.type === 'cleared') broadcaster.emit('alarm:cleared', { alarm_id: e.alarm_id });
    }
  }
}

async function start(emitter) {
  if (!env.dataGenerator.enabled) {
    logger.info('data generator disabled');
    return;
  }
  broadcaster = emitter;
  sensorsCache = await dbSvc.loadActiveSensors();
  logger.info('data generator starting', {
    sensors: sensorsCache.length, intervalMs: env.dataGenerator.intervalMs,
  });
  timer = setInterval(() => {
    step().catch((err) => logger.error('data generator step failed', { err: err.message }));
  }, env.dataGenerator.intervalMs);
  // Kick off immediately so first chart points appear fast
  step().catch(() => {});
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

/** Reload the sensor list (call after CRUD changes to the catalogue). */
async function refresh() {
  sensorsCache = await dbSvc.loadActiveSensors();
  logger.info('data generator sensors refreshed', { count: sensorsCache.length });
}

module.exports = { start, stop, refresh };
