/**
 * Dashboard — plant-wide overview.
 *
 * Shows:
 *  • KPI cards (equipment online, active alarms, avg health, ML status)
 *  • Time range picker (Live / 1h / 6h / 24h / 7d / All)
 *    — defaults to "All" so the whole project history is visible on first open
 *  • 4 featured sensor charts (one per main equipment, measurement-appropriate type)
 *  • Active alarms panel
 *
 * Data flow
 * ─────────
 *  Live range : REST seeds the WS ring buffer → WebSocket appends in real time
 *  All others : REST API with bucket aggregation → displayed directly
 *               (WS is still connected so KPI cards stay fresh)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Equipment, Alarms, Predictions, Sensors } from '../services/api';
import { useLiveFeed } from '../services/websocket';
import KPICards      from '../components/Dashboard/KPICards';
import AlertsPanel   from '../components/Dashboard/AlertsPanel';
import SensorChart   from '../components/Charts/SensorChart';
import TimeRangePicker, { getRangeParams } from '../components/Charts/TimeRangePicker';

export default function Dashboard() {
  // ── KPI state ──────────────────────────────────────────────────────────────
  const [health,     setHealth]     = useState(null);
  const [alarms,     setAlarms]     = useState([]);
  const [alarmStats, setAlarmStats] = useState(null);
  const [mlStatus,   setMlStatus]   = useState(null);
  const [error,      setError]      = useState('');

  // ── Chart state ───────────────────────────────────────────────────────────
  const [range,     setRange]     = useState('all');   // default: all available data
  const [chartData, setChartData] = useState({});      // { sensor_id: [{ts,value,...}] }
  const [loading,   setLoading]   = useState(false);
  const liveSeeded = useRef(false);

  // ── WebSocket ─────────────────────────────────────────────────────────────
  const { readings, latestAlarm, connected, seedHistorical } = useLiveFeed({});

  // ── KPI loader ────────────────────────────────────────────────────────────
  const loadKPIs = useCallback(async () => {
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
      setError(e.response?.data?.message || e.message || 'Failed to load dashboard');
    }
  }, []);

  useEffect(() => { loadKPIs(); }, [loadKPIs]);
  useEffect(() => {
    const t = setInterval(loadKPIs, 30_000);
    return () => clearInterval(t);
  }, [loadKPIs]);
  useEffect(() => { if (latestAlarm) loadKPIs(); }, [latestAlarm, loadKPIs]);

  // ── Derive featured sensors (1 per equipment, max 4) ──────────────────────
  const featured = useMemo(() => {
    const list = [];
    (health?.equipment || []).forEach(eq => {
      (eq.sensors || []).slice(0, 1).forEach(s => list.push({ ...s, equipment: eq }));
    });
    return list.slice(0, 4);
  }, [health]);

  // ── Chart data loader ─────────────────────────────────────────────────────
  const loadChartData = useCallback(async (sensors, selectedRange) => {
    if (!sensors?.length) return;
    setLoading(true);
    liveSeeded.current = false;

    const { from, bucket } = getRangeParams(selectedRange);

    try {
      const results = await Promise.all(
        sensors.map(s =>
          Sensors.readings(s.id, { from, bucket, limit: 5000 })
            .then(res => ({
              id: s.id,
              points: (res.points || []).map(p => ({
                ts:    p.ts,
                value: Number(p.value),
                ...(p.min != null ? { min: Number(p.min), max: Number(p.max) } : {}),
              })),
            }))
            .catch(() => ({ id: s.id, points: [] }))
        )
      );

      const newData = {};
      for (const { id, points } of results) newData[id] = points;
      setChartData(newData);

      // Seed the WS ring buffer so "Live" mode starts with real history.
      if (selectedRange === 'live' && !liveSeeded.current) {
        liveSeeded.current = true;
        seedHistorical(newData);
      }
    } finally {
      setLoading(false);
    }
  }, [seedHistorical]);

  // Reload when range changes or featured sensors become available.
  useEffect(() => {
    if (featured.length) loadChartData(featured, range);
  }, [featured, range, loadChartData]);

  // Auto-refresh Live seed every 60 s.
  useEffect(() => {
    if (range !== 'live' || !featured.length) return;
    const t = setInterval(() => loadChartData(featured, 'live'), 60_000);
    return () => clearInterval(t);
  }, [range, featured, loadChartData]);

  // ── Choose data source per sensor ─────────────────────────────────────────
  // Live: WebSocket ring buffer (real-time updates)
  // Historical: REST API response (full period, aggregated)
  const getSensorData = (sensor) =>
    range === 'live'
      ? (readings[sensor.id] || [])
      : (chartData[sensor.id] || []);

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div>
      {/* ── Top bar: WS indicator + time range picker ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 10, marginBottom: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
            background: connected ? '#2cd08c' : '#f0a83a',
            boxShadow: connected ? '0 0 0 2px rgba(44,208,140,.2)' : 'none',
          }} />
          <span style={{ fontSize: 12, color: '#7b8799' }}>
            {connected ? 'WebSocket live' : 'Reconnecting…'}
          </span>
          {loading && (
            <span style={{ fontSize: 11, color: '#7b8799', marginLeft: 8 }}>
              Loading charts…
            </span>
          )}
        </div>
        <TimeRangePicker value={range} onChange={setRange} disabled={loading} />
      </div>

      {error && (
        <div className="error" style={{ marginBottom: 12 }}>
          ⚠ {error} — verify that all Docker containers are running
          (<code>docker compose up -d</code>)
        </div>
      )}

      {/* ── KPI cards ── */}
      <KPICards health={health} alarmStats={alarmStats} mlStatus={mlStatus} />

      {/* ── Featured sensor charts ── */}
      <div style={{ marginTop: 16 }}>
        {/* Section header */}
        {featured.length > 0 && (
          <div style={{
            fontSize: 11, fontWeight: 700, color: '#7b8799',
            letterSpacing: '.8px', textTransform: 'uppercase',
            marginBottom: 10, borderLeft: '3px solid #4da3ff', paddingLeft: 10,
          }}>
            Featured sensors — {featured.length} equipment · {
              range === 'all' ? 'Full project history' :
              range === 'live' ? 'Live feed' :
              `Last ${range}`
            }
          </div>
        )}

        <div className="grid-2">
          {featured.map(s => (
            <SensorChart
              key={s.id}
              sensorId={s.id}
              measurement={s.measurement}
              title={`${s.equipment.tag} · ${s.name}`}
              unit={s.unit || ''}
              data={getSensorData(s)}
              thresholds={{ h1: s.h1, h2: s.h2, l1: s.l1, l2: s.l2 }}
              height={220}
              live={range === 'live' && connected}
            />
          ))}

          {!featured.length && !error && (
            <div className="card" style={{ padding: 28, color: '#4a5568', gridColumn: '1 / -1' }}>
              {health
                ? '⚠ No sensors found in the database. Ensure seed.sql ran successfully.'
                : '⏳ Loading equipment list…'}
            </div>
          )}
        </div>
      </div>

      {/* ── Alarms panel ── */}
      <div style={{ marginTop: 16 }}>
        <AlertsPanel alarms={alarms} onRefresh={loadKPIs} />
      </div>
    </div>
  );
}
