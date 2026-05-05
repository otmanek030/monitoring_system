/**
 * DigitalTwinTooltip — small popover shown when the user hovers an
 * equipment shape on the plant mimic. Pulled into its own file to keep
 * DigitalTwin.js focused on the SVG rendering.
 */
import React from 'react';

export default function DigitalTwinTooltip({ eq, slot, liveReadings }) {
  const sensors = eq.sensors || [];
  const h = Number(eq.health_score) || 0;
  const c = h >= 70 ? '#16a34a' : h >= 40 ? '#d97706' : '#dc2626';

  return (
    <div style={{
      position: 'absolute',
      top: 12, right: 18,
      background: '#fff',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '10px 12px',
      minWidth: 240,
      maxWidth: 300,
      boxShadow: '0 8px 24px rgba(16,40,24,.15)',
      fontSize: 11.5,
      zIndex: 5,
      pointerEvents: 'none',
    }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        gap: 6, marginBottom: 6, paddingBottom: 6,
        borderBottom: '1px solid var(--border)',
      }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--tx)' }}>
            {slot?.label || eq.name}
          </div>
          <code style={{ fontSize: 10.5, color: 'var(--g)' }}>{eq.tag}</code>
        </div>
        <span style={{
          padding: '3px 9px', borderRadius: 12,
          fontSize: 11, fontWeight: 700,
          background: c + '15', color: c,
          fontFamily: "'JetBrains Mono', monospace",
        }}>{h.toFixed(0)}%</span>
      </div>

      <div style={{ display: 'flex', gap: 12, fontSize: 10.5, color: 'var(--td)', marginBottom: 8 }}>
        <span>Status <strong style={{ color: 'var(--tx)' }}>{eq.status}</strong></span>
        {eq.criticality != null && (
          <span>Crit <strong style={{ color: 'var(--tx)' }}>{eq.criticality}/5</strong></span>
        )}
        <span>Sensors <strong style={{ color: 'var(--tx)' }}>{sensors.length}</strong></span>
      </div>

      {sensors.length > 0 && (
        <>
          <div style={{
            fontSize: 9.5, fontWeight: 700, color: 'var(--tm)',
            textTransform: 'uppercase', letterSpacing: 0.6,
            marginBottom: 4,
          }}>Live readings</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {sensors.slice(0, 6).map(s => {
              const sid  = s.id ?? s.sensor_id;
              const buf  = liveReadings[sid] || [];
              const last = buf[buf.length - 1];
              const val  = last?.value ?? s.last_value;
              return (
                <div key={sid} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                  gap: 6,
                  padding: '2px 6px',
                  background: 'var(--g-softer)',
                  borderRadius: 3,
                }}>
                  <span style={{
                    color: 'var(--tm)', fontSize: 10,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    maxWidth: 140,
                  }} title={s.tag_code || s.tag || s.name}>
                    {s.measurement || s.tag_code || s.name}
                  </span>
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    color: 'var(--tx)', fontWeight: 600,
                    fontSize: 11,
                  }}>
                    {val != null ? Number(val).toFixed(2) : '--'}
                    <span style={{ color: 'var(--td)', marginLeft: 3, fontWeight: 400 }}>{s.unit || ''}</span>
                  </span>
                </div>
              );
            })}
            {sensors.length > 6 && (
              <span style={{ color: 'var(--td)', fontSize: 9.5, paddingLeft: 6 }}>
                +{sensors.length - 6} more sensors
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
