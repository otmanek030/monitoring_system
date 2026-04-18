/**
 * Paginated list of all equipment with quick status + health badges.
 * Clicking a row navigates to EquipmentDetail.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Equipment as EqApi } from '../services/api';

const statusPill = (s) => {
  const map = {
    running:     { bg: '#1c3c2b', fg: '#2cd08c' },
    idle:        { bg: '#2a3a55', fg: '#9fb6d9' },
    fault:       { bg: '#5a1a20', fg: '#ff5566' },
    maintenance: { bg: '#4a3a1a', fg: '#ffb04a' },
    stopped:     { bg: '#2a2f3b', fg: '#7b8799' },
  };
  return map[s] || map.idle;
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

  return (
    <div>
      <div className="page-head">
        <h2>Equipment</h2>
        <input placeholder="Filter by tag or name"
               value={filter} onChange={(e) => setFilter(e.target.value)}
               style={{ width: 260 }} />
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Tag</th><th>Name</th><th>Area</th><th>Type</th>
              <th>Status</th><th>Health</th><th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map(e => (
              <tr key={e.id}>
                <td><code>{e.tag}</code></td>
                <td>{e.name}</td>
                <td>{e.area_code || '--'}</td>
                <td className="muted">{e.type_name || '--'}</td>
                <td>
                  <span className="badge" style={statusPill(e.status)}>{e.status}</span>
                </td>
                <td>
                  <HealthBar value={Number(e.health_score) || 0} />
                </td>
                <td style={{ textAlign: 'right' }}>
                  <Link className="ghost small" to={`/equipment/${e.id}`}>Open →</Link>
                </td>
              </tr>
            ))}
            {!visible.length && (
              <tr><td colSpan="7" className="muted" style={{ textAlign: 'center', padding: 24 }}>
                No equipment matches your filter.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HealthBar({ value }) {
  const v = Math.max(0, Math.min(100, value));
  const c = v >= 70 ? '#2cd08c' : v >= 40 ? '#ffb04a' : '#ff5566';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div className="meter" style={{ width: 120 }}>
        <div className="meter-fill" style={{ width: `${v}%`, background: c }} />
      </div>
      <span style={{ color: c, fontSize: 12 }}>{v.toFixed(0)}</span>
    </div>
  );
}
