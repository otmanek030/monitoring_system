/**
 * OPC UA SCADA connector (optional - enable via env OPCUA_ENABLED=true).
 *
 * Subscribes to every sensor with a non-null opc_node_id. Each node change
 * produces a reading that follows the same path as the synthetic generator:
 * DB insert + alarm evaluation + WebSocket broadcast.
 *
 * This is a production-ready skeleton: you can point OPCUA_ENDPOINT at any
 * real OPC UA server (Siemens PLC, AVEVA, Wonderware InTouch, Schneider EcoStruxure,
 * Prosys SimulationServer) and it will start ingesting.
 */
'use strict';

const env = require('../config/env');
const logger = require('../config/logger');
const dbSvc = require('../services/dbService');
const alarmEngine = require('../services/alarmEngine');

let client = null;
let session = null;
let subscription = null;
let broadcaster = null;

async function start(emitter) {
  if (!env.opcua.enabled) {
    logger.info('opcua disabled');
    return;
  }
  // Lazy-require so the app doesn't pay the startup cost when disabled.
  let opcua;
  try {
    opcua = require('node-opcua');
  } catch (err) {
    logger.error('node-opcua not installed; run npm install', { err: err.message });
    return;
  }

  broadcaster = emitter;
  const {
    OPCUAClient, AttributeIds, MessageSecurityMode, SecurityPolicy, TimestampsToReturn,
  } = opcua;

  client = OPCUAClient.create({
    applicationName: 'PhoswatchBackend',
    connectionStrategy: { initialDelay: 1000, maxRetry: 5 },
    securityMode: MessageSecurityMode.None,
    securityPolicy: SecurityPolicy.None,
    endpointMustExist: false,
  });

  try {
    await client.connect(env.opcua.endpoint);
    session = env.opcua.username
      ? await client.createSession({ userName: env.opcua.username, password: env.opcua.password })
      : await client.createSession();
    logger.info('opcua connected', { endpoint: env.opcua.endpoint });

    subscription = await session.createSubscription2({
      requestedPublishingInterval: 1000,
      requestedMaxKeepAliveCount: 20,
      requestedLifetimeCount: 6000,
      maxNotificationsPerPublish: 1000,
      publishingEnabled: true,
      priority: 10,
    });

    // Subscribe to each sensor that has an OPC node id
    const sensors = await dbSvc.loadActiveSensors();
    for (const s of sensors.filter((x) => x.opc_node_id)) {
      const monitored = await subscription.monitor(
        { nodeId: s.opc_node_id, attributeId: AttributeIds.Value },
        { samplingInterval: s.sampling_period_ms, discardOldest: true, queueSize: 10 },
        TimestampsToReturn.Both
      );
      monitored.on('changed', async (dv) => {
        const value = Number(dv?.value?.value);
        if (!Number.isFinite(value)) return;
        const ts = dv?.sourceTimestamp || new Date();
        try {
          await dbSvc.insertReadings([{ sensor_id: s.sensor_id, value, ts, quality: 192 }]);
          const ev = await alarmEngine.evaluate(s, value, ts);
          if (broadcaster) {
            broadcaster.emit('reading', {
              sensor_id: s.sensor_id, equipment_id: s.equipment_id,
              tag_code: s.tag_code, value, unit: s.unit, ts,
            });
            for (const e of ev) {
              if (e.type === 'new')     broadcaster.emit('alarm:new', e.alarm);
              if (e.type === 'cleared') broadcaster.emit('alarm:cleared', { alarm_id: e.alarm_id });
            }
          }
        } catch (err) {
          logger.error('scada ingest failed', { err: err.message, sensor: s.tag_code });
        }
      });
    }
    logger.info('opcua subscriptions active', { count: sensors.filter((x) => x.opc_node_id).length });
  } catch (err) {
    logger.error('opcua start failed', { err: err.message });
  }
}

async function stop() {
  try { await subscription?.terminate(); } catch (_) {}
  try { await session?.close(); } catch (_) {}
  try { await client?.disconnect(); } catch (_) {}
  subscription = session = client = null;
}

module.exports = { start, stop };
