/**
 * CascadeRiskPanel - top "if X fails, Y will too" chains.
 *
 * Polls /api/predictions/cascade every 30 s. Visual layout:
 *   - panel head with refresh button
 *   - 3-cell KPI strip (critical / warning / total chains - just counts)
 *   - scrollable list of ChainCard rows (constrained to fit alongside
 *     the Digital Twin so the two panels match in height)
 *   - empty-state: green check + reassuring message
 *
 * The panel is designed to fit inside a parent grid cell that gives it
 * a height of ~480 px; everything below the KPI strip scrolls.
 */
import React, { useEffect, useState } from 'react';
import { Predictions } from '../../services/api';

export default function CascadeRiskPanel({ minRisk = 0.30, limit = 20, refreshMs = 30000 }) {
  const [data, setData]       = useState(null);
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const r = await Predictions.cascade({ min: minRisk, limit });
      setData(r);
      setError('');
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Failed to load cascade risk');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, refreshMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minRisk, limit, refreshMs]);

  const chains  = data?.chains || [];
  const summary = data?.summary || {};
  const showEmpty = !error && chains.length === 0 && !loading;

  return (
    <div className="panel" style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      maxHeight: '100%',
      minHeight: 0,
      overflow: 'hidden',     // makes the inner scroll work
    }}>
      {/* Header */}
      <div className="panel-head" style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 22, height: 22, borderRadius: 4,
          background: '#fee2e2', color: '#dc2626',
          fontSize: 13, marginRight: 8, fontWeight: 700,
        }}>!</span>
        <span className="title">Cascading Failure Risk</span>
        <span style={{ fontSize: 10.5, color: 'var(--td)', marginLeft: 6 }}>
          downstream propagation
        </span>
        <button
          onClick={load}
          disabled={loading}
          style={{
            marginLeft: 'auto',
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 4,
            color: 'var(--tm)', cursor: loading ? 'wait' : 'pointer',
            fontSize: 10.5, padding: '2px 8px',
          }}
          title="Refresh"
        >
          {loading ? '...' : 'refresh'}
        </button>
      </div>

      {/* KPI strip */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 6, padding: '8px 10px',
        background: 'linear-gradient(180deg, #fafdfb 0%, #f3f8f5 100%)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <KpiCard label="Critical" value={summary.critical_chains || 0} color="#dc2626" />
        <KpiCard label="Warning"  value={summary.warning_chains  || 0} color="#d97706" />
        <KpiCard label="Tracked"  value={summary.total_chains    || 0} color="#16a34a" />
      </div>

      {/* Scrollable body */}
      <div style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        // Custom thin scrollbar
        scrollbarWidth: 'thin',
        scrollbarColor: 'var(--border) transparent',
      }}>
        {error && (
          <div style={{ padding: 14, fontSize: 11.5, color: '#dc2626', background: '#fee2e2' }}>
            {error}
          </div>
        )}

        {showEmpty && (
          <div style={{ padding: '36px 16px', textAlign: 'center', color: 'var(--tm)', fontSize: 12.5 }}>
            <div style={{
              width: 40, height: 40, margin: '0 auto 10px',
              borderRadius: '50%', background: '#dcfce7', color: '#16a34a',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, fontWeight: 700,
            }}>OK</div>
            <div style={{ fontWeight: 600, color: 'var(--tx)' }}>No cascade risk detected</div>
            <div style={{ fontSize: 11, color: 'var(--td)', marginTop: 4 }}>
              All chains are below {Math.round(minRisk * 100)}%
            </div>
          </div>
        )}

        {chains.map((c, i) => (
          <ChainCard key={`${c.upstream.id}-${c.downstream.id}-${i}`} chain={c} />
        ))}
      </div>

      {/* Footer */}
      {data?.generated_at && (
        <div style={{
          fontSize: 9.5, color: 'var(--td)',
          padding: '5px 10px', textAlign: 'right',
          borderTop: '1px solid var(--border)',
          background: '#fafdfb',
          flexShrink: 0,
        }}>
          updated {new Date(data.generated_at).toLocaleTimeString('en-GB',
            { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, color }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 6, padding: '6px 8px',
      border: '1px solid var(--border)',
      textAlign: 'center', position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: 3, background: color }} />
      <div style={{
        fontSize: 9, color: 'var(--td)',
        textTransform: 'uppercase', letterSpacing: 0.5,
        fontWeight: 600, marginTop: 2,
      }}>{label}</div>
      <div style={{
        fontSize: 18, fontWeight: 700, color,
        fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.2,
      }}>{value}</div>
    </div>
  );
}

function ChainCard({ chain }) {
  // Clamp risk to [0,1] defensively in case the API returns slightly out-of-range values.
  const r   = Math.max(0, Math.min(1, Number(chain.combined_risk) || 0));
  const pct = Math.round(r * 100);
  const palette = r >= 0.85 ? { col: '#991b1b', bg: '#fee2e2', label: 'CRITICAL' }
                : r >= 0.70 ? { col: '#dc2626', bg: '#fee2e2', label: 'HIGH' }
                : r >= 0.55 ? { col: '#d97706', bg: '#fef3c7', label: 'WARNING' }
                : r >= 0.40 ? { col: '#a07910', bg: '#fef3c7', label: 'WATCH' }
                :             { col: '#475569', bg: '#f1f5f9', label: 'LOW' };

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '4px 1fr 56px',
      borderBottom: '1px solid var(--border)',
      background: r >= 0.7 ? 'rgba(220,38,38,.025)' : '#fff',
    }}>
      <div style={{ background: palette.col }} />

      <div style={{ padding: '8px 10px 8px 12px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
          <span style={{
            background: palette.bg, color: palette.col,
            padding: '1px 6px', borderRadius: 3,
            fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
            fontFamily: "'JetBrains Mono', monospace",
          }}>{palette.label}</span>
          <code style={{ fontSize: 10.5, color: 'var(--g)', fontWeight: 700 }}>
            {chain.upstream.tag}
          </code>
          <ArrowFlow color={palette.col} />
          <code style={{ fontSize: 10.5, color: 'var(--tx)', fontWeight: 600 }}>
            {chain.downstream.tag}
          </code>
        </div>

        <div style={{ fontSize: 11, color: 'var(--tm)', lineHeight: 1.45, marginBottom: 4 }}>
          {chain.description}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 10, color: 'var(--td)' }}>
          <span>~{chain.hours_to_impact}h</span>
          <span>w={Number(chain.weight).toFixed(2)}</span>
          <span>base {Math.round((chain.upstream.base_risk || 0) * 100)}%</span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '6px 8px' }}>
        <RiskDonut pct={pct} color={palette.col} />
      </div>
    </div>
  );
}

function ArrowFlow({ color }) {
  return (
    <svg width="20" height="10" viewBox="0 0 20 10">
      <path d="M 0 5 L 16 5" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M 13 1 L 18 5 L 13 9" stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RiskDonut({ pct, color }) {
  const size = 44;
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.max(0, Math.min(100, pct)) / 100) * c;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size/2} cy={size/2} r={r}
          stroke="#eef2f0" strokeWidth={stroke} fill="none" />
        <circle cx={size/2} cy={size/2} r={r}
          stroke={color} strokeWidth={stroke} fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size/2} ${size/2})`}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700, color,
        fontFamily: "'JetBrains Mono', monospace",
      }}>{pct}%</div>
    </div>
  );
}
