/**
 * DigitalTwin - SCADA-style mimic of the Benguerir washing & flotation
 * circuit. See DigitalTwinTooltip.js for the hover popover.
 *
 * Single source of truth = LAYOUT (slot key -> position, shape, label,
 * matching keywords). Each piece of equipment is matched against the
 * keywords (or the slot key as a substring) and placed in that slot.
 *
 * Pipes are routed orthogonally (one elbow per pipe) so the diagram
 * looks like a real P&ID.
 */
import React, { useMemo, useState } from 'react';
import DigitalTwinTooltip from './DigitalTwinTooltip';
import { LAYOUT, PIPES, port, elbowPath, matchSlot, statusColors } from './digitalTwinModel';
import EquipmentShape from './DigitalTwinShape';

export default function DigitalTwin({ equipment = [], liveReadings = {}, height = 460 }) {
  const [hovered, setHovered] = useState(null);

  /* Map slot key -> first matching equipment (one per slot) */
  const slotEq = useMemo(() => {
    const m = {};
    for (const eq of equipment) {
      const key = matchSlot(eq);
      if (key && !m[key]) m[key] = eq;
    }
    return m;
  }, [equipment]);

  const placedCount = Object.keys(slotEq).length;
  const totalEq     = equipment.length;
  const offstage    = Math.max(0, totalEq - placedCount);

  const summary = useMemo(() => {
    let healthy = 0, atRisk = 0, fault = 0, idle = 0;
    for (const key of Object.keys(slotEq)) {
      const eq = slotEq[key];
      if (eq.status === 'fault') { fault++; continue; }
      if (eq.status === 'stopped' || eq.status === 'idle') { idle++; continue; }
      const h = Number(eq.health_score) || 0;
      if (h < 40) fault++;
      else if (h < 70) atRisk++;
      else healthy++;
    }
    return { healthy, atRisk, fault, idle };
  }, [slotEq]);

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="panel-head" style={{ display: 'flex', alignItems: 'center' }}>
        <span className="title">Digital Twin - Plant Layout</span>
        <span style={{ fontSize: 10.5, color: 'var(--td)', marginLeft: 6 }}>
          live mimic - hover for sensor values
        </span>
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          <Chip color="#16a34a" bg="#dcfce7" label="Healthy" value={summary.healthy} />
          <Chip color="#d97706" bg="#fef3c7" label="At-risk" value={summary.atRisk} />
          <Chip color="#dc2626" bg="#fee2e2" label="Critical" value={summary.fault} />
          <Chip color="#64748b" bg="#f1f5f9" label="Idle" value={summary.idle} />
        </div>
        <span className="menu" style={{ marginLeft: 8 }}>...</span>
      </div>

      <div style={{
        position: 'relative',
        padding: '10px 12px',
        background: 'linear-gradient(180deg, #f8fbf9 0%, #eef5f0 100%)',
        flex: 1, minHeight: 0,
      }}>
        <svg
          viewBox="0 0 1100 440"
          preserveAspectRatio="xMidYMid meet"
          style={{ width: '100%', height, display: 'block' }}
          onMouseLeave={() => setHovered(null)}
        >
          <defs>
            <pattern id="dt-grid" width="44" height="44" patternUnits="userSpaceOnUse">
              <path d="M 44 0 L 0 0 0 44" fill="none" stroke="rgba(22,84,52,.05)" strokeWidth="1" />
            </pattern>
            <marker id="dt-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#7e9a8c" />
            </marker>
          </defs>

          <rect width="1100" height="440" fill="url(#dt-grid)" />

          {/* Section bands */}
          <g opacity="0.5">
            <rect x="20"  y="10" width="280" height="420" rx="6" fill="#fff" stroke="rgba(22,84,52,.08)" strokeDasharray="4 4" />
            <rect x="310" y="10" width="240" height="420" rx="6" fill="#fff" stroke="rgba(22,84,52,.08)" strokeDasharray="4 4" />
            <rect x="560" y="10" width="310" height="420" rx="6" fill="#fff" stroke="rgba(22,84,52,.08)" strokeDasharray="4 4" />
            <rect x="880" y="10" width="210" height="420" rx="6" fill="#fff" stroke="rgba(22,84,52,.08)" strokeDasharray="4 4" />
          </g>
          <text x="160" y="28" textAnchor="middle" fill="#6b8278" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1 }}>FEED</text>
          <text x="430" y="28" textAnchor="middle" fill="#6b8278" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1 }}>WASHING</text>
          <text x="715" y="28" textAnchor="middle" fill="#6b8278" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1 }}>FLOTATION</text>
          <text x="985" y="28" textAnchor="middle" fill="#6b8278" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1 }}>OUTPUT</text>

          {/* Pipes */}
          {PIPES.map((p, i) => {
            const fromSlot = LAYOUT[p.from];
            const toSlot   = LAYOUT[p.to];
            if (!fromSlot || !toSlot) return null;
            if (!slotEq[p.from] || !slotEq[p.to]) return null;
            const a = port(fromSlot, p.fSide);
            const b = port(toSlot,   p.tSide);
            return (
              <g key={i}>
                <path d={elbowPath(a, b)} stroke="#bcd0c5" strokeWidth="6" fill="none"
                  strokeLinecap="round" strokeLinejoin="round" />
                <path d={elbowPath(a, b)} stroke="#7e9a8c" strokeWidth="2" fill="none"
                  strokeLinecap="round" strokeLinejoin="round" markerEnd="url(#dt-arrow)" />
              </g>
            );
          })}

          {/* Equipment */}
          {Object.entries(slotEq).map(([key, eq]) => {
            const slot = LAYOUT[key];
            const isHovered = hovered?.eq?.id === eq.id;
            return (
              <EquipmentShape
                key={eq.id}
                slot={slot}
                eq={eq}
                colors={statusColors(eq)}
                hovered={isHovered}
                onEnter={() => setHovered({ eq, slot })}
                onLeave={() => setHovered(null)}
              />
            );
          })}
        </svg>

        {hovered && (
          <DigitalTwinTooltip eq={hovered.eq} slot={hovered.slot} liveReadings={liveReadings} />
        )}

        {/* Legend strip */}
        <div style={{
          marginTop: 6,
          display: 'flex', alignItems: 'center', gap: 14,
          padding: '6px 10px',
          background: '#fff',
          border: '1px solid var(--border)',
          borderRadius: 6,
          fontSize: 10.5, color: 'var(--tm)', flexWrap: 'wrap',
        }}>
          <LegendDot color="#16a34a" label="Healthy >= 70%" />
          <LegendDot color="#d97706" label="At-risk 40-69%" />
          <LegendDot color="#dc2626" label="Critical / Fault" />
          <LegendDot color="#94a3b8" label="Idle / Stopped" />
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
            <span><strong style={{ color: 'var(--tx)' }}>{placedCount}</strong> on diagram</span>
            {offstage > 0 && <span title="Equipment without a layout slot">+{offstage} off-diagram</span>}
          </span>
        </div>
      </div>
    </div>
  );
}

function Chip({ color, bg, label, value }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: bg, color,
      padding: '2px 8px', borderRadius: 10,
      fontSize: 10.5, fontWeight: 700,
      fontFamily: "'JetBrains Mono', monospace",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      {label} {value}
    </span>
  );
}

function LegendDot({ color, label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{
        width: 9, height: 9, borderRadius: '50%', background: color,
        display: 'inline-block', boxShadow: '0 0 0 1px #fff',
      }} />
      {label}
    </span>
  );
}
