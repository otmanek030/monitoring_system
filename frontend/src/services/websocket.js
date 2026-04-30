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
 * @param {number} [opts.equipmentId]   - also subscribe to equipment:<id> room
 * @param {number} [opts.bufferSize=300]- ring buffer size per sensor
 * @returns {{
 *   readings, latestAlarm, connected, seedHistorical,
 *   anomalyPredictions,   // { [sensor_id]: latest payload }
 *   failurePredictions,   // { [equipment_id]: latest payload }
 *   latestAnomaly,        // last received (any sensor)
 *   latestFailure,        // last received (any equipment)
 * }}
 */
export function useLiveFeed({ equipmentId, bufferSize = 300 } = {}) {
  const [readings, setReadings]                     = useState({});
  const [latestAlarm, setLatestAlarm]               = useState(null);
  const [connected, setConnected]                   = useState(false);
  const [anomalyPredictions, setAnomalyPredictions] = useState({});
  const [failurePredictions, setFailurePredictions] = useState({});
  const [latestAnomaly, setLatestAnomaly]           = useState(null);
  const [latestFailure, setLatestFailure]           = useState(null);
  const bufRef = useRef({});

  const seedHistorical = useCallback((historical) => {
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
      setReadings((prev) => ({ ...prev, [r.sensor_id]: next }));
    };
    const onAlarmNew    = (a) => setLatestAlarm(a);
    const onAnomaly     = (p) => {
      setLatestAnomaly(p);
      setAnomalyPredictions(prev => ({ ...prev, [p.sensor_id]: p }));
    };
    const onFailure     = (p) => {
      setLatestFailure(p);
      setFailurePredictions(prev => ({ ...prev, [p.equipment_id]: p }));
    };

    sock.on('connect',             onConnect);
    sock.on('disconnect',          onDisconnect);
    sock.on('reading',             onReading);
    sock.on('alarm:new',           onAlarmNew);
    sock.on('prediction:anomaly',  onAnomaly);
    sock.on('prediction:failure',  onFailure);

    if (sock.connected) setConnected(true);
    if (equipmentId) sock.emit('subscribe:equipment', equipmentId);

    return () => {
      if (equipmentId) sock.emit('unsubscribe:equipment', equipmentId);
      sock.off('connect',            onConnect);
      sock.off('disconnect',         onDisconnect);
      sock.off('reading',            onReading);
      sock.off('alarm:new',          onAlarmNew);
      sock.off('prediction:anomaly', onAnomaly);
      sock.off('prediction:failure', onFailure);
    };
  }, [equipmentId, bufferSize]);

  return {
    readings, latestAlarm, connected, seedHistorical,
    anomalyPredictions, failurePredictions,
    latestAnomaly, latestFailure,
  };
}
