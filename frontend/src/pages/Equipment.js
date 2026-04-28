/**
 * Equipment — paginated registry with health bars, dynamic RUL, and predictive insights.
 * Dark-themed using CSS variable palette.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Equipment as EqApi, Predictions } from '../services/api';

/* Status → badge class mapping */
const statusClass = (s) => {
  const map = {
    running:     'badge ok',
    idle:        'badge idle',
    fault:       'badge bad',
    maintenance: 'badge warn',
    stopped:     'badge stopped',
  };
  return map[s] || 'badge idle';
};

/* Health score → color */
const healthColor = (v) => {
  if (v >= 70) return 'var(--g)';
  if (v >= 40) return 'var(--yellow)';
  return 'var(--red)';
};

/** Format RUL hours into a human-readable string */
function formatRul(rulHours) {
  if (rulHours == null || isNaN(rulHours)) return '—';
  const h = Number(rulHours);
  if (h < 1) return '< 1 h';
  if (h < 48) return `${Math.round(h)} h`;
  const days = Math.floor(h / 24);
  if (days < 60) return `${days} days`;
  const months = Math.floor(days / 30);
  const remDays = days % 30;
  return remDays > 0 ? `${months} mo ${remDays} d` : `${months} months`;
}

/** RUL color based on remaining life */
const rulColor = (h) => {
  if (h == null || isNaN(h)) return 'var(--tm)';
  if (h < 168)  return 'var(--red)';     // < 1 week — critical
  if (h < 720)  return 'var(--yellow)';  // < 1 month — warning
  return 'var(--g)';                      // > 1 month — ok
};

export default function EquipmentPage() {
  const [items, setItems]   = useState([]);
  const [rulMap, setRulMap] = useState({});
  const [error, setError]   = useState('');
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);

  /* Load equipment list */
  useEffect(() => {
    EqApi.list()
      .then((d) => {
        const list = d.items || d;
        setItems(list);
        setLoading(false);
        // Fetch RUL for each equipment in the background
        list.forEach(eq => {
          Predictions.rul(eq.id)
            .then(r => {
              if (r) setRulMap(prev => ({ ...prev, [eq.id]: r }));
            })
            .catch(() => {}); // silently skip if ML offline
        });
      })
      .catch((e) => {
        setError(e.response?.data?.message || 'Failed to load equipment');
        setLoading(false);
      });
  }, []);

  const visible = items.filter(i =>
    !filter ||
    (i.tag || '').toLowerCase().includes(filter.toLowerCase()) ||
    (i.name || '').toLowerCase().includes(filter.toLowerCase())
  );

  /* Status summary counts */
  const counts = items.reduce((acc, i) => {
    acc[i.status] = (acc[i.status] || 0) + 1;
    return acc;
  }, {});

  /* Health distribution for summary */
  const healthBuckets = { good: 0, warn: 0, critical: 0 };
  items.forEach(e => {
    const h = Number(e.health_score) || 0;
    if (h >= 70) healthBuckets.good++;
    else if (h >= 40) healthBuckets.warn++;
    else healthBuckets.critical++;
  });

  return (
    <div>
      {/* Page head */}
      <div className="page-head">
        <div>
          <h2>Equipment Registry</h2>
          <div style={{ fontSize: 11.5, color: 'var(--tm)', marginTop: 2 }}>
            {items.length} units ·
            <span style={{ color: 'var(--g)', marginLeft: 6 }}>{counts.running || 0} running</span>
            {counts.fault > 0 && <span style={{ color: 'var(--red)', marginLeft: 6 }}>{counts.fault} fault</span>}
            {counts.maintenance > 0 && <span style={{ color: 'var(--yellow)', marginLeft: 6 }}>{counts.maintenance} maintenance</span>}
            <span style={{ marginLeft: 10, color: 'var(--tm)' }}>·</span>
            <span style={{ color: 'var(--g)', marginLeft: 6 }}>{healthBuckets.good} healthy</span>
            {healthBuckets.warn > 0 && <span style={{ color: 'var(--yellow)', marginLeft: 6 }}>{healthBuckets.warn} at-risk</span>}
            {healthBuckets.critical > 0 && <span style={{ color: 'var(--red)', marginLeft: 6 }}>{healthBuckets.critical} critical</span>}
          </div>
        </div>
        <input
          placeholder="Filter by tag or name…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ width: 240 }}
        />
      </div>

      {error && <div className="error">{error}</div>}

      <div className="panel">
        <div className="panel-head">
          <span className="title">Equipment Registry</span>
          <span style={{ fontSize: 10.5, color: 'var(--tm)' }}>{visible.length} entries</span>
          <span className="menu">⋯</span>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Tag</th>
                <th>Name</th>
                <th>Area</th>
                <th>Type</th>
                <th>Status</th>
                <th>Health</th>
                <th>RUL Est.</th>
                <th style={{ textAlign: 'right' }}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(e => {
                const h = Number(e.health_score) || 0;
                const rul = rulMap[e.id];
                const rulHours = rul?.rul_hours;
                return (
                  <tr key={e.id}>
                    <td>
                      <code style={{ fontSize: 11.5 }}>{e.tag}</code>
                    </td>
                    <td style={{ fontWeight: 500 }}>{e.name}</td>
                    <td style={{ color: 'var(--tm)' }}>{e.area_code || '—'}</td>
                    <td style={{ color: 'var(--tm)', fontSize: 11.5 }}>{e.type_name || '—'}</td>
                    <td>
                      <span className={statusClass(e.status)}>{e.status}</span>
                    </td>
                    <td>
                      <HealthBar value={h} />
                    </td>
                    <td>
                      <span style={{
                        fontSize: 11.5,
                        fontFamily: "'JetBrains Mono', monospace",
                        fontWeight: 600,
                        color: rulColor(rulHours),
                      }}>
                        {rul ? formatRul(rulHours) : <span style={{ color: 'var(--td)', fontWeight: 400 }}>loading…</span>}
                      </span>
                      {rul?.recommendation && (
                        <div style={{ fontSize: 10, color: 'var(--td)', maxWidth: 160, lineHeight: 1.3, marginTop: 2 }}>
                          {rul.recommendation.length > 50
                            ? rul.recommendation.slice(0, 48) + '…'
                            : rul.recommendation}
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <Link
                        to={`/equipment/${e.id}`}
                        className="ghost small"
                        style={{
                          display: 'inline-block',
                          padding: '3px 9px',
                          borderRadius: 4,
                          border: '1px solid var(--border-2)',
                          color: 'var(--g)',
                          fontSize: 11.5,
                          textDecoration: 'none',
                          background: 'transparent',
                          transition: 'all .12s',
                        }}
                      >
                        Open →
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {!visible.length && (
                <tr>
                  <td colSpan="8" style={{ textAlign: 'center', padding: 28, color: 'var(--tm)', fontSize: 13 }}>
                    {loading ? '⏳ Loading equipment list…' : filter ? 'No equipment matches your filter.' : 'No equipment found.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function HealthBar({ value }) {
  const v = Math.max(0, Math.min(100, value));
  const c = healthColor(v);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 100, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${v}%`, height: '100%', background: c, borderRadius: 3, transition: 'width .4s' }} />
      </div>
      <span style={{
        color: c,
        fontSize: 11,
        fontFamily: "'JetBrains Mono', monospace",
        fontWeight: 600,
        minWidth: 28,
      }}>
        {v.toFixed(0)}%
      </span>
    </div>
  );
}
