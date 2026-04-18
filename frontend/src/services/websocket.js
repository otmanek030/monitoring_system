/**
 * Socket.io client wrapper with a React hook.
 *
 * `useLiveFeed({ equipmentId })` returns { readings, alarms } and auto-
 * subscribes to the correct room. Handles reconnection + token rotation.
 */
import { io } from 'socket.io-client';
import { useEffect, useRef, useState } from 'react';

let _socket = null;

export function getSocket() {
  if (_socket && _socket.connected) return _socket;
  const token = localStorage.getItem('phoswatch.token');
  _socket = io('/', {
    path: '/socket.io',
    transports: ['websocket'],
    auth: { token },
    reconnection: true,
    reconnectionDelay: 1500,
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
 * @param {number} [opts.equipmentId] - also subscribe to equipment:<id> room
 * @param {number} [opts.bufferSize=300] - ring buffer size per sensor
 */
export function useLiveFeed({ equipmentId, bufferSize = 300 } = {}) {
  const [readings, setReadings] = useState({});   // { sensor_id: [{ts,value}, ...] }
  const [latestAlarm, setLatestAlarm] = useState(null);
  const [connected, setConnected] = useState(false);
  const bufRef = useRef({});

  useEffect(() => {
    const sock = getSocket();

    const onConnect    = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onReading = (r) => {
      const buf = bufRef.current[r.sensor_id] || [];
      const next = [...buf, { ts: r.ts, value: r.value }];
      if (next.length > bufferSize) next.splice(0, next.length - bufferSize);
      bufRef.current[r.sensor_id] = next;
      // Shallow update so React re-renders
      setReadings((prev) => ({ ...prev, [r.sensor_id]: next }));
    };
    const onAlarmNew = (a) => setLatestAlarm(a);

    sock.on('connect',      onConnect);
    sock.on('disconnect',   onDisconnect);
    sock.on('reading',      onReading);
    sock.on('alarm:new',    onAlarmNew);

    if (equipmentId) sock.emit('subscribe:equipment', equipmentId);

    return () => {
      if (equipmentId) sock.emit('unsubscribe:equipment', equipmentId);
      sock.off('connect',    onConnect);
      sock.off('disconnect', onDisconnect);
      sock.off('reading',    onReading);
      sock.off('alarm:new',  onAlarmNew);
    };
  }, [equipmentId, bufferSize]);

  return { readings, latestAlarm, connected };
}
