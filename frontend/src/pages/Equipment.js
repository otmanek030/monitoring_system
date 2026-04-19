/**
 * Equipment — paginated list with status badges and health bars.
 * Dark-themed using CSS variable palette.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Equipment as EqApi } from '../services/api';

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

export default function Equipment() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    EqApi.list()
      .then((d) => setItems(d.items || d))
      .catch((e) => setError(e.response?.data?.message || 'Failed to load'));
  }, []);

  const visible = items.filter(i =>
    !filter ||
    i.tag.toLowerCase().includes(filter.toLowerCase()) ||
    (i.name || '').toLowerCase().includes(filter.toLowerCase())
  );

  /* Status summary counts */
  const counts = items.reduce((acc, i) => {
    acc[i.status] = (acc[i.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      {/* Page head */}
      <div className="page-head">
        <div>
          <h2>Equipment</h2>
          <div style={{ fontSize: 11.5, color: 'var(--tm)', marginTop: 2 }}>
            {items.length} equipment units ·
            <span style={{ color: 'var(--g)', marginLeft: 6 }}>{counts.running || 0} running</span>
            {counts.fault > 0 && <span style={{ color: 'var(--red)', marginLeft: 6 }}>{counts.fault} fault</span>}
            {counts.maintenance > 0 && <span style={{ color: 'var(--yellow)', marginLeft: 6 }}>{counts.maintenance} maintenance</span>}
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
                <th style={{ textAlign: 'right' }}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(e => {
                const h = Number(e.health_score) || 0;
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
                  <td colSpan="7" style={{ textAlign: 'center', padding: 28, color: 'var(--tm)', fontSize: 13 }}>
                    {filter ? 'No equipment matches your filter.' : '⏳ Loading equipment list…'}
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
        {v.toFixed(0)}
      </span>
    </div>
  );
}
