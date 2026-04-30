/**
 * WebSocket (Socket.io) layer.
 *
 * - JWT handshake: `auth: { token }` or `?token=...` in the connection URL.
 * - Rooms:
 *     * 'dashboard'          -> global feed (all readings, alarms)
 *     * 'equipment:<id>'     -> readings/alarms for a single equipment
 * - The backend services publish via the returned emitter; clients consume.
 *
 * Emitted events:
 *     'reading'         {sensor_id, equipment_id, tag_code, value, unit, ts}
 *     'alarm:new'       {alarm_id, ts, equipment_id, sensor_id, severity, message, trigger_value}
 *     'alarm:cleared'   {alarm_id}
 *     'prediction'      {type: 'anomaly'|'failure'|'rul', ...}
 *     'kpi'             {activeAlarms, equipmentRunning, ...}
 */
'use strict';

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { EventEmitter } = require('events');
const env = require('../config/env');
const logger = require('../config/logger');

/**
 * @param httpServer - Node http.Server
 * @returns { io, emitter } — emit from services, io.to(room).emit under the hood
 */
function init(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.corsOrigin, credentials: true },
    path: '/socket.io',
    transports: ['websocket', 'polling'],
  });

  // JWT handshake
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('missing token'));
    try {
      const p = jwt.verify(token, env.jwtSecret);
      socket.user = { id: p.sub, username: p.username, role: p.role };
      next();
    } catch (err) {
      next(new Error('invalid token'));
    }
  });

  io.on('connection', (socket) => {
    logger.info('ws connect', { user: socket.user.username, id: socket.id });
    socket.join('dashboard');

    socket.on('subscribe:equipment', (id) => {
      if (id) socket.join(`equipment:${id}`);
    });
    socket.on('unsubscribe:equipment', (id) => {
      if (id) socket.leave(`equipment:${id}`);
    });

    socket.on('disconnect', () => {
      logger.debug('ws disconnect', { user: socket.user.username });
    });
  });

  // Internal emitter used by dataGenerator / scadaConnector.
  // Converts into the right Socket.io rooms.
  const emitter = new EventEmitter();

  emitter.on('reading', (r) => {
    io.to('dashboard').emit('reading', r);
    if (r.equipment_id) io.to(`equipment:${r.equipment_id}`).emit('reading', r);
  });
  emitter.on('alarm:new', (a) => {
    io.to('dashboard').emit('alarm:new', a);
    if (a.equipment_id) io.to(`equipment:${a.equipment_id}`).emit('alarm:new', a);
  });
  emitter.on('alarm:cleared', (a) => {
    io.to('dashboard').emit('alarm:cleared', a);
  });
  emitter.on('prediction', (p) => io.to('dashboard').emit('prediction', p));
  // Auto-AI predictions (no manual trigger). Routed to both 'dashboard' and
  // the per-equipment room so EquipmentDetail picks them up too.
  emitter.on('prediction:anomaly', (p) => {
    io.to('dashboard').emit('prediction:anomaly', p);
    if (p.equipment_id) io.to(`equipment:${p.equipment_id}`).emit('prediction:anomaly', p);
  });
  emitter.on('prediction:failure', (p) => {
    io.to('dashboard').emit('prediction:failure', p);
    if (p.equipment_id) io.to(`equipment:${p.equipment_id}`).emit('prediction:failure', p);
  });
  emitter.on('kpi', (k)        => io.to('dashboard').emit('kpi', k));

  return { io, emitter };
}

module.exports = { init };
