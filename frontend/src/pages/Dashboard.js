/**
 * Plant-wide overview: KPIs, live charts of the most important sensors, and
 * the active-alarm panel. Subscribes to the Socket.io "dashboard" room.
 */
import { useEffect, useMemo, useState } from 'react';
import { Equipment, Alarms, Predictions } from '../services/api';
import { useLiveFeed } from '../services/websocket';
import KPICards    from '../components/Dashboard/KPICards';
import RealTimeChart from '../components/Dashboard/RealTimeChart';
import AlertsPanel from '../components/Dashboard/AlertsPanel';

export default function Dashboard() {
  const [health,     setHealth]     = useState(null);
  const [alarms,     setAlarms]     = useState([]);
  const [alarmStats, setAlarmStats] = useState(null);
  const [mlStatus,   setMlStatus]   = useState(null);
  const [sensors,    setSensors]    = useState([]);
  const [error,      setError]      = useState('');

  // No equipmentId -> client only joins the global "dashboard" room.
  const { readings, latestAlarm } = useLiveFeed({});

  const loadAll = async () => {
    try {
      const [h, a, s, m] = await Promise.all([
        Equipment.health(),
        Alarms.list({ status: 'active', limit: 50 }),
        Alarms.stats(),
        Predictions.mlHealth().catch(() => ({ ok: false })),
      ]);
      setHealth(h);
      setAlarms(a.items || a);
      setAlarmStats(s);
      setMlStatus(m);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load dashboard');
    }
  };

  useEffect(() => { loadAll(); }, []);

  // When a new alarm is pushed via WebSocket, refresh the list.
  useEffect(() => { if (latestAlarm) loadAll(); }, [latestAlarm]);

  // Pick the 4 "featured" sensors (by importance / low unit if tagged).
  const featured = useMemo(() => {
    const list = [];
    (health?.equipment || []).forEach(eq => {
      (eq.sensors || []).slice(0, 1).forEach(s => list.push({ ...s, equipment: eq }));
    });
    return list.slice(0, 4);
  }, [health]);

  return (
    <div>
      {error && <div className="error">{error}</div>}

      <KPICards health={health} alarmStats={alarmStats} mlStatus={mlStatus} />

      <div className="grid-2" style={{ marginTop: 16 }}>
        {featured.map(s => (
          <RealTimeChart
            key={s.id}
            title={`${s.equipment.tag} · ${s.name}`}
            unit={s.unit || ''}
            data={readings[s.id] || []}
            thresholds={{ h1: s.h1, h2: s.h2, l1: s.l1, l2: s.l2 }}
          />
        ))}
        {!featured.length && (
          <div className="card muted" style={{ padding: 20 }}>
            Live feed will appear as soon as the data generator publishes readings.
          </div>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <AlertsPanel alarms={alarms} onRefresh={loadAll} />
      </div>
    </div>
  );
}
