/**
 * Socket.io client wrapper with a React hook.
 *
 * `useLiveFeed({ equipmentId })` returns { readings, latestAlarm, connected, seedHistorical }
 * and auto-subscribes to the correct room. Handles reconnection + token rotation.
 *
 * Key improvement: `seedHistorical(data)` lets callers pre-populate the ring
 * buffer with REST-API data so charts are never blank on first load.
 */
import { io } from 'socket.io-client';
import { useCallback, useEffect, useRef, useState } from 'react';

let _socket = null;

export function getSocket() {
  // Re-use an existing socket if it is still alive (connected OR reconnecting).
  // Do NOT create a new socket just because it is temporarily disconnected —
  // Socket.io will reconnect automatically.
  if (_socket && (_socket.connected || _socket.active)) return _socket;

  const token = localStorage.getItem('phoswatch.token');
  _socket = io('/', {
    path: '/socket.io',
    // Allow polling as a fallback in case WebSocket upgrade is slow.
    transports: ['websocket', 'polling'],
    auth: { token },
    reconnection: true,
    reconnectionDelay: 1500,
    reconnectionAttempts: Infinity,
  });
  return _socket;
}

export function closeSocket() {
  if (_socket) {
    _socket.close();
    _socket = null;
  }
}

/**
 * React hook: subscribe to the live feed.
 * @param {Object} opts
 * @param {number} [opts.equipmentId]  - also subscribe to equipment:<id> room
 * @param {number} [opts.bufferSize=300] - ring buffer size per sensor
 * @returns {{ readings, latestAlarm, connected, seedHistorical }}
 *   seedHistorical({ [sensor_id]: [{ts, value}] }) — pre-populate from REST API
 */
export function useLiveFeed({ equipmentId, bufferSize = 300 } = {}) {
  const [readings, setReadings] = useState({});   // { sensor_id: [{ts,value}, ...] }
  const [latestAlarm, setLatestAlarm] = useState(null);
  const [connected, setConnected] = useState(false);
  const bufRef = useRef({});

  // Expose a way to pre-seed the buffer with historical REST-API data.
  // Called AFTER `featured` sensors are known (see Dashboard.js).
  const seedHistorical = useCallback((historical) => {
    // Merge historical data into the buffer; live WS readings will append after.
    const next = { ...historical };
    bufRef.current = next;
    setReadings({ ...next });
  }, []);

  useEffect(() => {
    const sock = getSocket();

    const onConnect    = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onReading = (r) => {
      const buf = bufRef.current[r.sensor_id] || [];
      const next = [...buf, { ts: r.ts, value: r.value }];
      if (next.length > bufferSize) next.splice(0, next.length - bufferSize);
      bufRef.current[r.sensor_id] = next;
      // Shallow-copy triggers React re-render only for the changed key.
      setReadings((prev) => ({ ...prev, [r.sensor_id]: next }));
    };
    const onAlarmNew = (a) => setLatestAlarm(a);

    sock.on('connect',      onConnect);
    sock.on('disconnect',   onDisconnect);
    sock.on('reading',      onReading);
    sock.on('alarm:new',    onAlarmNew);

    // Immediately mark connected if the socket is already up.
    if (sock.connected) setConnected(true);

    if (equipmentId) sock.emit('subscribe:equipment', equipmentId);

    return () => {
      if (equipmentId) sock.emit('unsubscribe:equipment', equipmentId);
      sock.off('connect',    onConnect);
      sock.off('disconnect', onDisconnect);
      sock.off('reading',    onReading);
      sock.off('alarm:new',  onAlarmNew);
    };
  }, [equipmentId, bufferSize]);

  return { readings, latestAlarm, connected, seedHistorical };
}
