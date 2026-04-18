/**
 * Plant-wide overview: KPIs, live charts of the most important sensors, and
 * the active-alarm panel. Subscribes to the Socket.io "dashboard" room.
 *
 * Data flow:
 *  1. loadAll()  — fetches KPI data (equipment health, alarm stats, ML status)
 *  2. featured   — derived from health: first sensor of each equipment (max 4)
 *  3. loadHistorical() — once `featured` is known, loads last 5 min from REST API
 *                        and seeds the WebSocket buffer so charts aren't blank
 *  4. useLiveFeed      — appends real-time WebSocket readings on top
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Equipment, Alarms, Predictions, Sensors } from '../services/api';
import { useLiveFeed } from '../services/websocket';
import KPICards      from '../components/Dashboard/KPICards';
import RealTimeChart from '../components/Dashboard/RealTimeChart';
import AlertsPanel   from '../components/Dashboard/AlertsPanel';

// How many minutes of historical data to pre-load into each chart.
const HISTORY_MINUTES = 5;

export default function Dashboard() {
  const [health,     setHealth]     = useState(null);
  const [alarms,     setAlarms]     = useState([]);
  const [alarmStats, setAlarmStats] = useState(null);
  const [mlStatus,   setMlStatus]   = useState(null);
  const [error,      setError]      = useState('');
  const [wsStatus,   setWsStatus]   = useState('connecting');
  const histLoadedRef = useRef(false); // guard: load history only once

  // No equipmentId → client joins the global "dashboard" room automatically.
  const { readings, latestAlarm, connected, seedHistorical } = useLiveFeed({});

  // Track WebSocket status for the indicator badge.
  useEffect(() => {
    setWsStatus(connected ? 'live' : 'reconnecting');
  }, [connected]);

  // ─── KPI data (REST) ────────────────────────────────────────────────────────
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
      setError('');
    } catch (e) {
      const msg = e.response?.data?.message || e.message || 'Failed to load dashboard';
      setError(msg);
    }
  };

  useEffect(() => { loadAll(); }, []);

  // Refresh KPI data every 30 s so the page doesn't go stale.
  useEffect(() => {
    const t = setInterval(loadAll, 30_000);
    return () => clearInterval(t);
  }, []);

  // When a new alarm arrives via WebSocket, refresh the panel immediately.
  useEffect(() => { if (latestAlarm) loadAll(); }, [latestAlarm]);

  // ─── Featured sensors (max 4 — one per equipment) ──────────────────────────
  const featured = useMemo(() => {
    const list = [];
    (health?.equipment || []).forEach(eq => {
      (eq.sensors || []).slice(0, 1).forEach(s => list.push({ ...s, equipment: eq }));
    });
    return list.slice(0, 4);
  }, [health]);

  // ─── Historical seed (REST → buffer) ───────────────────────────────────────
  // Runs once after `featured` is first populated so the charts show data
  // immediately instead of waiting for the first WebSocket ticks.
  useEffect(() => {
    if (!featured.length || histLoadedRef.current) return;
    histLoadedRef.current = true;

    const from = new Date(Date.now() - HISTORY_MINUTES * 60 * 1000).toISOString();

    Promise.all(
      featured.map(s =>
        Sensors.readings(s.id, { from, bucket: 'raw', limit: 500 })
          .then(res => ({ id: s.id, points: res.points || [] }))
          .catch(() => ({ id: s.id, points: [] }))
      )
    ).then(results => {
      const hist = {};
      for (const { id, points } of results) {
        // Normalise to { ts, value } — same shape the WS hook expects.
        hist[id] = points.map(p => ({ ts: p.ts, value: Number(p.value) }));
      }
      seedHistorical(hist);
    });
  }, [featured, seedHistorical]);

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Connection status badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span
          style={{
            display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
            background: wsStatus === 'live' ? '#2cd08c' : '#ffb04a',
          }}
        />
        <span className="muted" style={{ fontSize: 12 }}>
          {wsStatus === 'live' ? 'Live — WebSocket connected' : 'Reconnecting to live feed…'}
        </span>
      </div>

      {error && (
        <div className="error" style={{ marginBottom: 12 }}>
          ⚠ {error} — check that all Docker containers are running
          (<code>docker compose up -d</code>)
        </div>
      )}

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
        {!featured.length && !error && (
          <div className="card" style={{ padding: 24, color: 'var(--muted)' }}>
            {health
              ? 'No sensors found. Check that seed.sql ran successfully.'
              : 'Loading equipment list…'}
          </div>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <AlertsPanel alarms={alarms} onRefresh={loadAll} />
      </div>
    </div>
  );
}
