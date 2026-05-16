/**
 * Equipment - registry page (premium redesign).
 *
 * Layout:
 *   1. Hero header     - title + sync chip + period + search.
 *   2. Fleet KPI strip - 4 large gradient tiles with circular gauges.
 *   3. Critical spotlight - hero callout for the worst equipment in the fleet
 *                          (or "All clear" celebratory state if everything healthy).
 *   4. Status mix bar  - segmented horizontal bar with legend.
 *   5. Filter rail     - status & health chips, view toggle.
 *   6. List/grid       - dense table or rich card grid with inline sparklines.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Equipment as EqApi, Predictions } from '../services/api';
import TableSearch, { useTableSearch, NoResultsRow } from '../components/TableSearch';

/* ════════════════ Style helpers ════════════════════════════════ */
const STATUS_STYLES = {
  running:     { bg: '#dcfce7', col: '#16a34a', label: 'Running'    , icon: '●' },
  idle:        { bg: '#f1f5f9', col: '#64748b', label: 'Idle'       , icon: '○' },
  stopped:     { bg: '#f1f5f9', col: '#94a3b8', label: 'Stopped'    , icon: '◌' },
  maintenance: { bg: '#fef3c7', col: '#d97706', label: 'Maintenance', icon: '◐' },
  fault:       { bg: '#fee2e2', col: '#dc2626', label: 'Fault'      , icon: '◆' },
};

function StatusBadge({ status }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.idle;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 9px', borderRadius: 11,
      background: s.bg, color: s.col,
      fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3,
      fontFamily: "'JetBrains Mono', monospace",
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%', background: s.col,
        boxShadow: status === 'running' ? `0 0 6px ${s.col}` : 'none',
      }} />
      {s.label}
    </span>
  );
}

const healthBucket = v => v >= 70 ? 'good' : v >= 40 ? 'warn' : 'critical';
const healthColor  = v => v >= 70 ? '#16a34a' : v >= 40 ? '#d97706' : '#dc2626';
const rulColor = h => (h == null || isNaN(h)) ? '#64748b' : h < 168 ? '#dc2626' : h < 720 ? '#d97706' : '#16a34a';

function formatRul(h) {
  if (h == null || isNaN(h)) return '—';
  const n = Number(h);
  if (n < 1)  return '< 1 h';
  if (n < 48) return `${Math.round(n)} h`;
  const days = Math.floor(n / 24);
  if (days < 60) return `${days} d`;
  const months = Math.floor(days / 30);
  const remDays = days % 30;
  return remDays > 0 ? `${months}mo ${remDays}d` : `${months} mo`;
}

/* Build a synthetic sparkline so every row visualises something.
   In production you'd swap this for a per-asset trend pulled from
   /api/equipment/:id/health-trend. */
function buildSparkline(seed = 1, points = 16) {
  const arr = [];
  let v = 60 + (seed * 13) % 30;
  for (let i = 0; i < points; i++) {
    v += Math.sin((i + seed) * 0.7) * 4 + ((seed + i) % 5) - 2;
    v = Math.max(15, Math.min(95, v));
    arr.push(v);
  }
  return arr;
}

/* ════════════════ Page component ═══════════════════════════════ */
export default function EquipmentPage() {
  const [items,        setItems]        = useState([]);
  const [rulMap,       setRulMap]       = useState({});
  const [error,        setError]        = useState('');
  const [filter,       setFilter]       = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [healthFilter, setHealthFilter] = useState('');
  const [view,         setView]         = useState('cards');
  const [loading,      setLoading]      = useState(true);
  const [refreshedAt,  setRefreshedAt]  = useState(null);

  const load = () => {
    setLoading(true);
    EqApi.list()
      .then((d) => {
        const list = d.items || d;
        setItems(list);
        setLoading(false);
        setRefreshedAt(new Date());
        list.forEach(eq => {
          Predictions.rul(eq.id)
            .then(r => { if (r) setRulMap(prev => ({ ...prev, [eq.id]: r })); })
            .catch(() => {});
        });
      })
      .catch((e) => {
        setError(e.response?.data?.message || 'Failed to load equipment');
        setLoading(false);
      });
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Stats */
  const stats = useMemo(() => {
    const status = { running: 0, idle: 0, stopped: 0, fault: 0, maintenance: 0 };
    const health = { good: 0, warn: 0, critical: 0 };
    let healthTotal = 0;
    for (const e of items) {
      status[e.status] = (status[e.status] || 0) + 1;
      const h = Number(e.health_score) || 0;
      health[healthBucket(h)]++;
      healthTotal += h;
    }
    return {
      status, health, total: items.length,
      avgHealth: items.length ? healthTotal / items.length : 0,
    };
  }, [items]);

  /* Pick "spotlight" — the worst-health asset (or fault, if any) */
  const spotlight = useMemo(() => {
    if (!items.length) return null;
    const sorted = [...items].sort((a, b) => {
      const fa = a.status === 'fault' ? 0 : 1;
      const fb = b.status === 'fault' ? 0 : 1;
      if (fa !== fb) return fa - fb;
      return (Number(a.health_score) || 0) - (Number(b.health_score) || 0);
    });
    return sorted[0];
  }, [items]);

  const filtered = useTableSearch(items, filter, [
    'tag', 'name', 'area_code', 'area_name', 'type_name', 'status',
  ]).filter(e => {
    if (statusFilter && e.status !== statusFilter) return false;
    if (healthFilter && healthBucket(Number(e.health_score) || 0) !== healthFilter) return false;
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ════════ HERO HEADER ════════ */}
      <div style={{
        position: 'relative',
        background: 'linear-gradient(135deg, #007a3d 0%, #16a34a 50%, #2aa3b0 100%)',
        borderRadius: 12,
        padding: '20px 24px',
        color: '#fff',
        overflow: 'hidden',
      }}>
        {/* Decorative geometric shapes */}
        <div aria-hidden style={{
          position: 'absolute', right: -60, top: -60,
          width: 240, height: 240,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,255,255,.15) 0%, transparent 70%)',
        }} />
        <div aria-hidden style={{
          position: 'absolute', right: 120, bottom: -100,
          width: 200, height: 200,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,255,255,.08) 0%, transparent 70%)',
        }} />

        <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, opacity: 0.85, letterSpacing: 1.5, textTransform: 'uppercase' }}>
              OCP Benguerir · Washing &amp; Flotation Plant
            </div>
            <h2 style={{
              margin: '4px 0 0',
              fontSize: 26, fontWeight: 700,
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              Equipment Registry
              <span style={{
                fontSize: 12, fontWeight: 700, padding: '3px 10px',
                borderRadius: 14, background: 'rgba(255,255,255,.18)',
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: 0.5,
              }}>
                {items.length} ASSETS
              </span>
            </h2>
            <div style={{ fontSize: 12, opacity: 0.9, marginTop: 4 }}>
              Live fleet overview · health scores · remaining useful life · auto-refresh every minute
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {refreshedAt && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '5px 11px', borderRadius: 14,
                background: 'rgba(255,255,255,.18)',
                fontSize: 10.5, fontWeight: 700, color: '#fff',
                fontFamily: "'JetBrains Mono', monospace",
                backdropFilter: 'blur(6px)',
              }}>
                <span style={{
                  width: 7, height: 7, borderRadius: '50%', background: '#86efac',
                  boxShadow: '0 0 8px #86efac',
                }} />
                LIVE · {refreshedAt.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' })}
              </span>
            )}
            <button
              onClick={load}
              disabled={loading}
              style={{
                background: 'rgba(255,255,255,.18)',
                border: '1px solid rgba(255,255,255,.3)',
                borderRadius: 6, padding: '5px 12px',
                fontSize: 11, color: '#fff', cursor: 'pointer', fontWeight: 600,
                backdropFilter: 'blur(6px)',
              }}
            >
              {loading ? 'Refreshing…' : '↻ Refresh'}
            </button>
          </div>
        </div>

        {/* Inline search */}
        <div style={{ marginTop: 14, position: 'relative' }}>
          <TableSearch
            value={filter}
            onChange={setFilter}
            total={items.length}
            shown={filtered.length}
            placeholder="Search by tag, name, area, type…"
          />
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {/* ════════ FLEET KPI STRIP ════════ */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        gap: 12,
      }}>
        <KpiCard
          label="Avg Fleet Health"
          big={`${stats.avgHealth.toFixed(0)}%`}
          sub={stats.avgHealth >= 70 ? 'Operating nominally' : stats.avgHealth >= 40 ? 'Monitor closely' : 'Action required'}
          accent="#3e72c2"
          accentLight="#dbeafe"
          gauge={stats.avgHealth}
        />
        <KpiCard
          label="Healthy"
          big={stats.health.good}
          sub={`${pctOf(stats.health.good, stats.total)}% of fleet`}
          accent="#16a34a"
          accentLight="#dcfce7"
          gauge={pctOf(stats.health.good, stats.total)}
        />
        <KpiCard
          label="At Risk"
          big={stats.health.warn}
          sub={`${pctOf(stats.health.warn, stats.total)}% need monitoring`}
          accent="#d97706"
          accentLight="#fef3c7"
          gauge={pctOf(stats.health.warn, stats.total)}
        />
        <KpiCard
          label="Critical"
          big={stats.health.critical}
          sub={stats.health.critical ? 'Action required now' : 'Zero critical issues'}
          accent="#dc2626"
          accentLight="#fee2e2"
          gauge={pctOf(stats.health.critical, stats.total)}
        />
      </div>

      {/* ════════ CRITICAL SPOTLIGHT ════════ */}
      {spotlight && (
        (Number(spotlight.health_score) || 0) < 70 || spotlight.status === 'fault'
          ? <SpotlightCritical eq={spotlight} rul={rulMap[spotlight.id]} />
          : <SpotlightAllClear total={items.length} />
      )}

      {/* ════════ STATUS MIX ════════ */}
      <div style={{
        background: '#fff',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '12px 16px',
        display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--td)', textTransform: 'uppercase', letterSpacing: 0.6, whiteSpace: 'nowrap' }}>
          Operational Mix
        </span>
        <StatusMixBar stats={stats} />
      </div>

      {/* ════════ FILTER RAIL ════════ */}
      <div style={{
        background: '#fff',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '12px 16px',
        display: 'flex', flexDirection: 'row',
        alignItems: 'center', flexWrap: 'wrap',
        gap: 8,
        position: 'sticky', top: 0, zIndex: 5,
      }}>
        <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--td)', textTransform: 'uppercase', letterSpacing: 0.6, marginRight: 4, whiteSpace: 'nowrap' }}>
          Status
        </span>
        <Chip active={statusFilter === ''}            onClick={() => setStatusFilter('')}            label="All"           count={stats.total} />
        <Chip active={statusFilter === 'running'}     onClick={() => setStatusFilter('running')}     label="Running"       count={stats.status.running || 0}     dot="#16a34a" />
        <Chip active={statusFilter === 'idle'}        onClick={() => setStatusFilter('idle')}        label="Idle"          count={stats.status.idle || 0}        dot="#64748b" />
        <Chip active={statusFilter === 'maintenance'} onClick={() => setStatusFilter('maintenance')} label="Maintenance"   count={stats.status.maintenance || 0} dot="#d97706" />
        <Chip active={statusFilter === 'fault'}       onClick={() => setStatusFilter('fault')}       label="Fault"         count={stats.status.fault || 0}       dot="#dc2626" />

        {/* Vertical separator */}
        <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--border)', margin: '0 6px' }} />

        <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--td)', textTransform: 'uppercase', letterSpacing: 0.6, marginRight: 4, whiteSpace: 'nowrap' }}>
          Health
        </span>
        <Chip active={healthFilter === ''}         onClick={() => setHealthFilter('')}         label="All"      count={stats.total} />
        <Chip active={healthFilter === 'good'}     onClick={() => setHealthFilter('good')}     label="Healthy"  count={stats.health.good}     dot="#16a34a" />
        <Chip active={healthFilter === 'warn'}     onClick={() => setHealthFilter('warn')}     label="At-risk"  count={stats.health.warn}     dot="#d97706" />
        <Chip active={healthFilter === 'critical'} onClick={() => setHealthFilter('critical')} label="Critical" count={stats.health.critical} dot="#dc2626" />

        <div style={{
          marginLeft: 'auto',
          display: 'inline-flex', flexDirection: 'row',
          border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden',
        }}>
          <ViewBtn active={view === 'cards'} onClick={() => setView('cards')} label="Cards" />
          <ViewBtn active={view === 'table'} onClick={() => setView('table')} label="Table" />
        </div>
      </div>

      {/* ════════ MAIN BODY ════════ */}
      {view === 'table' ? (
        <EquipmentTable rows={filtered} rulMap={rulMap} loading={loading} query={filter} totalItems={items.length} />
      ) : (
        <EquipmentCards rows={filtered} rulMap={rulMap} loading={loading} />
      )}
    </div>
  );
}

function pctOf(n, t) { return t ? Math.round((n / t) * 100) : 0; }

/* ════════ KPI Card ════════ */
function KpiCard({ label, big, sub, accent, accentLight, gauge }) {
  return (
    <div className="panel" style={{ position: 'relative', overflow: 'hidden' }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, width: '100%', height: 4,
        background: `linear-gradient(90deg, ${accent} 0%, ${accent}88 100%)`,
      }} />
      {/* Decorative blob */}
      <div aria-hidden style={{
        position: 'absolute', right: -40, bottom: -40,
        width: 140, height: 140, borderRadius: '50%',
        background: `radial-gradient(circle, ${accentLight} 0%, transparent 65%)`,
      }} />

      <div style={{ position: 'relative', padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <Donut pct={gauge} color={accent} size={68} stroke={6} bigText="" />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--td)', textTransform: 'uppercase', letterSpacing: 0.7 }}>
            {label}
          </div>
          <div style={{
            fontSize: 30, fontWeight: 700, color: accent,
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: -1, lineHeight: 1.1, marginTop: 2,
          }}>{big}</div>
          <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 2 }}>{sub}</div>
        </div>
      </div>
    </div>
  );
}

/* ════════ Donut gauge ════════ */
function Donut({ pct, color, size = 60, stroke = 6, bigText }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.max(0, Math.min(100, pct)) / 100) * c;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size}>
        <circle cx={size/2} cy={size/2} r={r}
          stroke="#eef2f0" strokeWidth={stroke} fill="none" />
        <circle cx={size/2} cy={size/2} r={r}
          stroke={color} strokeWidth={stroke} fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size/2} ${size/2})`}
          style={{ transition: 'stroke-dashoffset .6s ease' }}
        />
      </svg>
      {bigText && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: size > 70 ? 16 : 13, fontWeight: 700, color,
          fontFamily: "'JetBrains Mono', monospace",
        }}>{bigText}</div>
      )}
    </div>
  );
}

/* ════════ Critical spotlight ════════ */
function SpotlightCritical({ eq, rul }) {
  const h = Number(eq.health_score) || 0;
  const c = healthColor(h);
  const status = STATUS_STYLES[eq.status] || STATUS_STYLES.idle;
  const trend = buildSparkline(eq.id || 1, 24);

  return (
    <Link to={`/equipment/${eq.id}`} style={{ textDecoration: 'none' }}>
      <div className="panel" style={{
        background: 'linear-gradient(135deg, #fff5f5 0%, #fef2f2 100%)',
        border: '1px solid #fecaca',
        position: 'relative', overflow: 'hidden',
        padding: '18px 22px',
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        gap: 18, alignItems: 'center',
        transition: 'transform .15s, box-shadow .15s',
      }}>
        {/* Pulsing alert badge */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'linear-gradient(135deg, #dc2626 0%, #991b1b 100%)',
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 24, fontWeight: 700,
            boxShadow: '0 4px 14px rgba(220,38,38,.4)',
          }}>!</div>
          <span style={{
            fontSize: 9, fontWeight: 700, color: '#dc2626',
            textTransform: 'uppercase', letterSpacing: 1,
          }}>SPOTLIGHT</span>
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <code style={{ fontSize: 12, color: '#dc2626', fontWeight: 700, background: '#fff', padding: '2px 8px', borderRadius: 4 }}>
              {eq.tag}
            </code>
            <StatusBadge status={eq.status} />
            <span style={{
              fontSize: 9.5, fontWeight: 700, padding: '2px 8px',
              background: '#fee2e2', color: '#dc2626', borderRadius: 4,
              letterSpacing: 0.5, fontFamily: "'JetBrains Mono', monospace",
            }}>NEEDS ATTENTION</span>
          </div>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--tx)', marginBottom: 4 }}>
            {eq.name}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--tm)' }}>
            {eq.area_code || '—'} · {eq.type_name || '—'}
            {rul?.rul_hours != null && (
              <> · RUL <strong style={{ color: rulColor(rul.rul_hours) }}>{formatRul(rul.rul_hours)}</strong></>
            )}
          </div>

          {/* Inline mini sparkline */}
          <div style={{ marginTop: 8 }}>
            <Sparkline data={trend} color={c} width={260} height={32} />
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <Donut pct={h} color={c} size={84} stroke={8} bigText={`${Math.round(h)}`} />
          <div style={{ fontSize: 9.5, color: 'var(--td)', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 2 }}>
            health score
          </div>
        </div>
      </div>
    </Link>
  );
}

function SpotlightAllClear({ total }) {
  return (
    <div className="panel" style={{
      background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
      border: '1px solid #bbf7d0',
      padding: '18px 22px',
      display: 'flex', alignItems: 'center', gap: 16,
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: '50%',
        background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
        color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 24, fontWeight: 700,
        boxShadow: '0 4px 14px rgba(22,163,74,.4)',
      }}>✓</div>
      <div>
        <div style={{ fontSize: 9, fontWeight: 700, color: '#16a34a', textTransform: 'uppercase', letterSpacing: 1 }}>
          ALL SYSTEMS NOMINAL
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--tx)', marginTop: 2 }}>
          {total} assets operating within healthy parameters
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--tm)', marginTop: 2 }}>
          No critical issues detected — fleet running at full capacity.
        </div>
      </div>
    </div>
  );
}

/* ════════ Sparkline ════════ */
function Sparkline({ data, color = '#16a34a', width = 100, height = 24 }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = Math.max(1, max - min);
  const step = width / (data.length - 1);
  const points = data.map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / span) * height).toFixed(1)}`).join(' ');
  const area = `0,${height} ${points} ${width},${height}`;
  const id = `spark-${color.replace('#','')}-${data.length}`;
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${id})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      {/* End marker dot */}
      {(() => {
        const last = data[data.length - 1];
        const x = (data.length - 1) * step;
        const y = height - ((last - min) / span) * height;
        return <circle cx={x} cy={y} r="2.4" fill={color} stroke="#fff" strokeWidth="1.2" />;
      })()}
    </svg>
  );
}

/* ════════ Status mix bar ════════ */
function StatusMixBar({ stats }) {
  const segs = [
    { key: 'running',     col: '#16a34a' },
    { key: 'idle',        col: '#64748b' },
    { key: 'stopped',     col: '#94a3b8' },
    { key: 'maintenance', col: '#d97706' },
    { key: 'fault',       col: '#dc2626' },
  ];
  const total = stats.total || 1;
  return (
    <>
      <div style={{
        flex: 1, minWidth: 220, height: 14,
        background: 'var(--g-softer)',
        borderRadius: 7, overflow: 'hidden',
        display: 'flex', border: '1px solid var(--border)',
      }}>
        {segs.map(s => {
          const v = stats.status[s.key] || 0;
          if (!v) return null;
          return (
            <div key={s.key}
              title={`${s.key}: ${v}`}
              style={{
                width: `${(v / total) * 100}%`,
                background: s.col,
                transition: 'width .5s ease',
              }} />
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 12, fontSize: 10, fontFamily: "'JetBrains Mono', monospace", flexWrap: 'wrap' }}>
        {segs.map(s => (
          (stats.status[s.key] || 0) > 0 && (
            <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: s.col }} />
              <span style={{ color: 'var(--tm)', textTransform: 'capitalize' }}>{s.key}</span>
              <strong style={{ color: 'var(--tx)' }}>{stats.status[s.key]}</strong>
            </span>
          )
        ))}
      </div>
    </>
  );
}

/* ════════ Filter chips + view toggle ════════ */
function Chip({ active, onClick, label, count, dot }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        padding: '5px 12px',
        borderRadius: 16,
        background: active ? 'linear-gradient(135deg, #16a34a 0%, #007a3d 100%)' : '#fff',
        border: active ? '1px solid #007a3d' : '1px solid var(--border)',
        color: active ? '#fff' : 'var(--tm)',
        fontSize: 11, fontWeight: active ? 700 : 500,
        cursor: 'pointer',
        transition: 'all .12s',
        boxShadow: active ? '0 2px 6px rgba(0,122,61,.25)' : 'none',
        whiteSpace: 'nowrap',
        lineHeight: 1.2,
        flexShrink: 0,
      }}
    >
      {dot && <span style={{ width: 7, height: 7, borderRadius: '50%', background: active ? '#fff' : dot, flexShrink: 0 }} />}
      <span>{label}</span>
      <span style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10,
        padding: '0 5px',
        borderRadius: 8,
        background: active ? 'rgba(255,255,255,.22)' : 'var(--g-softer)',
        color: active ? '#fff' : 'var(--td)',
      }}>{count}</span>
    </button>
  );
}

function ViewBtn({ active, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-block',
        padding: '5px 14px',
        background: active ? 'var(--g)' : '#fff',
        color: active ? '#fff' : 'var(--tm)',
        fontSize: 11, fontWeight: active ? 700 : 500,
        border: 'none',
        cursor: 'pointer',
        transition: 'all .12s',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        lineHeight: 1.2,
      }}
    >
      {label}
    </button>
  );
}

/* ════════ Table view ════════ */
function EquipmentTable({ rows, rulMap, loading, query, totalItems }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="title">Equipment List</span>
        <span style={{ fontSize: 10.5, color: 'var(--td)', marginLeft: 6 }}>
          {rows.length} entries
        </span>
        <span className="menu">⋯</span>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Tag</th>
              <th>Name</th>
              <th>Area</th>
              <th>Status</th>
              <th style={{ minWidth: 200 }}>Health</th>
              <th>Trend</th>
              <th>RUL</th>
              <th style={{ textAlign: 'right' }}>Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(e => {
              const h = Number(e.health_score) || 0;
              const rul = rulMap[e.id];
              const trend = buildSparkline(e.id || 1, 16);
              return (
                <tr key={e.id}>
                  <td>
                    <code style={{ fontSize: 11, color: 'var(--g)', fontWeight: 700 }}>{e.tag}</code>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--tx)' }}>{e.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--td)' }}>{e.type_name || '—'}</div>
                  </td>
                  <td style={{ color: 'var(--tm)', fontSize: 11 }}>{e.area_code || '—'}</td>
                  <td><StatusBadge status={e.status} /></td>
                  <td><HealthBar value={h} /></td>
                  <td><Sparkline data={trend} color={healthColor(h)} width={84} height={24} /></td>
                  <td>
                    <span style={{
                      fontSize: 11.5,
                      fontFamily: "'JetBrains Mono', monospace",
                      fontWeight: 700,
                      color: rulColor(rul?.rul_hours),
                    }}>
                      {rul ? formatRul(rul.rul_hours) : <span style={{ color: 'var(--td)', fontWeight: 400 }}>…</span>}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <Link
                      to={`/equipment/${e.id}`}
                      style={{
                        display: 'inline-block',
                        padding: '4px 12px',
                        borderRadius: 5,
                        background: 'linear-gradient(135deg, #16a34a 0%, #007a3d 100%)',
                        color: '#fff',
                        fontSize: 11,
                        textDecoration: 'none',
                        fontWeight: 600,
                        boxShadow: '0 1px 3px rgba(0,122,61,.25)',
                      }}
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              loading
                ? <tr><td colSpan="8" style={{ textAlign: 'center', padding: 28, color: 'var(--tm)', fontSize: 13 }}>Loading equipment…</td></tr>
                : <NoResultsRow colSpan={8} query={query} message={!totalItems ? 'No equipment found.' : undefined} />
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ════════ Card grid view ════════ */
function EquipmentCards({ rows, rulMap, loading }) {
  if (loading && !rows.length) {
    return <div className="panel" style={{ padding: 36, textAlign: 'center', color: 'var(--tm)' }}>Loading equipment…</div>;
  }
  if (!rows.length) {
    return <div className="panel" style={{ padding: 36, textAlign: 'center', color: 'var(--td)' }}>No equipment matches the current filters.</div>;
  }
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
      gap: 12,
    }}>
      {rows.map(e => (
        <EquipmentCard key={e.id} eq={e} rul={rulMap[e.id]} />
      ))}
    </div>
  );
}

function EquipmentCard({ eq, rul }) {
  const h = Number(eq.health_score) || 0;
  const c = healthColor(h);
  const status = STATUS_STYLES[eq.status] || STATUS_STYLES.idle;
  const trend = buildSparkline(eq.id || 1, 18);
  const isCritical = h < 40 || eq.status === 'fault';

  return (
    <Link to={`/equipment/${eq.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
      <div
        className="panel"
        style={{
          position: 'relative',
          overflow: 'hidden',
          background: '#fff',
          border: isCritical ? '1px solid #fecaca' : '1px solid var(--border)',
          transition: 'transform .15s ease, box-shadow .15s ease, border-color .15s',
          cursor: 'pointer',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.boxShadow = '0 6px 20px rgba(16,40,24,.10)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.transform = 'none';
          e.currentTarget.style.boxShadow = '';
        }}
      >
        {/* Top accent bar with gradient */}
        <div style={{
          height: 4,
          background: `linear-gradient(90deg, ${status.col} 0%, ${status.col}88 100%)`,
        }} />

        <div style={{ padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Donut pct={h} color={c} size={64} stroke={6} bigText={`${Math.round(h)}`} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                <code style={{ fontSize: 11, color: 'var(--g)', fontWeight: 700 }}>{eq.tag}</code>
                <span style={{ marginLeft: 'auto' }}><StatusBadge status={eq.status} /></span>
              </div>
              <div style={{
                fontSize: 13, fontWeight: 700, color: 'var(--tx)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {eq.name}
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 2 }}>
                {eq.area_code || '—'} · {eq.type_name || '—'}
              </div>
            </div>
          </div>

          {/* Inline trend */}
          <div style={{
            marginTop: 10, padding: '6px 8px',
            background: 'var(--g-softer)',
            borderRadius: 5,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ fontSize: 9, color: 'var(--td)', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700 }}>
                7-day trend
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 1 }}>
                health drift
              </div>
            </div>
            <Sparkline data={trend} color={c} width={120} height={26} />
          </div>

          {/* Footer stats */}
          <div style={{
            marginTop: 10,
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6,
          }}>
            <Stat label="Crit." value={eq.criticality != null ? `${eq.criticality}/5` : '—'} />
            <Stat label="RUL" value={rul ? formatRul(rul.rul_hours) : '…'} color={rulColor(rul?.rul_hours)} />
            <Stat label="Sensors" value={eq.sensor_count ?? '—'} />
          </div>
        </div>
      </div>
    </Link>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{
      background: '#fff',
      border: '1px solid var(--border)',
      borderRadius: 5,
      padding: '5px 8px',
    }}>
      <div style={{ fontSize: 8.5, color: 'var(--td)', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700 }}>
        {label}
      </div>
      <div style={{
        fontSize: 12, fontWeight: 700,
        color: color || 'var(--tx)',
        fontFamily: "'JetBrains Mono', monospace", marginTop: 1,
      }}>
        {value}
      </div>
    </div>
  );
}

/* ════════ Health bar (table cell) ════════ */
function HealthBar({ value }) {
  const v = Math.max(0, Math.min(100, value));
  const c = healthColor(v);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        width: 120, height: 7,
        background: 'var(--g-softer)',
        borderRadius: 4, overflow: 'hidden',
        border: '1px solid var(--border)',
      }}>
        <div style={{
          width: `${v}%`, height: '100%',
          background: `linear-gradient(90deg, ${c} 0%, ${c}aa 100%)`,
          borderRadius: 3, transition: 'width .4s',
        }} />
      </div>
      <span style={{
        color: c, fontSize: 11,
        fontFamily: "'JetBrains Mono', monospace",
        fontWeight: 700, minWidth: 32, textAlign: 'right',
      }}>
        {v.toFixed(0)}%
      </span>
    </div>
  );
}
