/**
 * DigitalTwinShape - one equipment glyph on the plant mimic.
 * Picks an SVG shape based on slot.shape and applies a colour palette
 * derived from the live status / health score.
 */
import React from 'react';

export default function EquipmentShape({ slot, eq, colors, hovered, onEnter, onLeave }) {
  const { x, y, w, h } = slot.pos;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const sw = hovered ? 2.4 : 1.6;
  const c  = colors;

  let body;
  switch (slot.shape) {
    case 'pump':
      body = (
        <>
          <circle cx={cx} cy={cy} r={Math.min(w, h) / 2}
            fill={c.fill} stroke={c.stroke} strokeWidth={sw} />
          <line x1={cx - w/4} y1={cy} x2={cx + w/4} y2={cy} stroke={c.stroke} strokeWidth="1.4" opacity="0.6" />
          <line x1={cx} y1={cy - h/4} x2={cx} y2={cy + h/4} stroke={c.stroke} strokeWidth="1.4" opacity="0.6" />
        </>
      );
      break;
    case 'cell':
      body = (
        <>
          <rect x={x} y={y} width={w} height={h} rx={6} ry={6}
            fill={c.fill} stroke={c.stroke} strokeWidth={sw} />
          <path d={`M ${x+6} ${y+10} Q ${cx} ${y+2} ${x+w-6} ${y+10}`}
            stroke={c.stroke} strokeWidth="1.3" fill="none" opacity="0.55" />
          <path d={`M ${x+6} ${y+18} Q ${cx} ${y+10} ${x+w-6} ${y+18}`}
            stroke={c.stroke} strokeWidth="1.1" fill="none" opacity="0.35" />
        </>
      );
      break;
    case 'cyclone':
      body = (
        <polygon
          points={`${x},${y} ${x+w},${y} ${x+w-8},${y+h-12} ${cx+2},${y+h} ${x+8},${y+h-12}`}
          fill={c.fill} stroke={c.stroke} strokeWidth={sw} strokeLinejoin="round"
        />
      );
      break;
    case 'hopper':
      body = (
        <polygon
          points={`${x},${y} ${x+w},${y} ${x+w*0.78},${y+h} ${x+w*0.22},${y+h}`}
          fill={c.fill} stroke={c.stroke} strokeWidth={sw} strokeLinejoin="round"
        />
      );
      break;
    case 'drum':
      body = (
        <>
          <rect x={x} y={y} width={w} height={h} rx={h/2} ry={h/2}
            fill={c.fill} stroke={c.stroke} strokeWidth={sw} />
          <line x1={x + w*0.25} y1={y + 8} x2={x + w*0.25} y2={y + h - 8}
            stroke={c.stroke} strokeWidth="1" opacity="0.4" />
          <line x1={x + w*0.75} y1={y + 8} x2={x + w*0.75} y2={y + h - 8}
            stroke={c.stroke} strokeWidth="1" opacity="0.4" />
        </>
      );
      break;
    case 'tank':
      body = (
        <>
          <rect x={x} y={y+8} width={w} height={h-8} rx={4}
            fill={c.fill} stroke={c.stroke} strokeWidth={sw} />
          <ellipse cx={cx} cy={y+8} rx={w/2} ry={6}
            fill={c.fill} stroke={c.stroke} strokeWidth={sw} />
          <line x1={x+4} y1={y+h*0.5} x2={x+w-4} y2={y+h*0.5}
            stroke={c.stroke} strokeWidth="1" strokeDasharray="3 2" opacity="0.5" />
        </>
      );
      break;
    case 'belt':
      body = (
        <>
          <rect x={x} y={y} width={w} height={h} rx={3}
            fill={c.fill} stroke={c.stroke} strokeWidth={sw} />
          {[0.2,0.4,0.6,0.8].map((t,i) => (
            <line key={i} x1={x + w*t} y1={y+3} x2={x + w*t - 6} y2={y+h-3}
              stroke={c.stroke} strokeWidth="1" opacity="0.4" />
          ))}
        </>
      );
      break;
    case 'agit':
      body = (
        <>
          <circle cx={cx} cy={cy} r={Math.min(w,h)/2}
            fill={c.fill} stroke={c.stroke} strokeWidth={sw} />
          <path d={`M ${cx - w/3} ${cy} L ${cx + w/3} ${cy} M ${cx} ${cy - w/3} L ${cx} ${cy + w/3}`}
            stroke={c.stroke} strokeWidth="1.6" />
        </>
      );
      break;
    case 'stacker':
      body = (
        <>
          <rect x={x} y={y+h*0.4} width={w*0.45} height={h*0.6} rx={3}
            fill={c.fill} stroke={c.stroke} strokeWidth={sw} />
          <line x1={x + w*0.22} y1={y + h*0.4} x2={x + w} y2={y}
            stroke={c.stroke} strokeWidth={sw + 1} strokeLinecap="round" />
          <circle cx={x + w} cy={y} r="4" fill={c.stroke} />
        </>
      );
      break;
    case 'boiler':
      body = (
        <>
          <rect x={x} y={y} width={w} height={h} rx={6}
            fill={c.fill} stroke={c.stroke} strokeWidth={sw} />
          <rect x={x + w*0.18} y={y - 8} width="6" height="10" fill={c.stroke} opacity="0.5" />
          <rect x={x + w*0.46} y={y - 12} width="6" height="14" fill={c.stroke} opacity="0.5" />
          <rect x={x + w*0.74} y={y - 8} width="6" height="10" fill={c.stroke} opacity="0.5" />
          <circle cx={cx} cy={cy+4} r="6" fill="#fb923c" opacity="0.35" />
        </>
      );
      break;
    default:
      body = (
        <rect x={x} y={y} width={w} height={h} rx={4}
          fill={c.fill} stroke={c.stroke} strokeWidth={sw} />
      );
  }

  return (
    <g
      onMouseEnter={onEnter}
      onMouseMove={onEnter}
      onMouseLeave={onLeave}
      style={{ cursor: 'pointer' }}
    >
      {hovered && (
        <rect x={x - 6} y={y - 6} width={w + 12} height={h + 12}
          rx={8} fill={c.glow} opacity="0.35" />
      )}
      {body}

      {/* Status pill (top-right) */}
      <circle cx={x + w - 5} cy={y + 5} r="5" fill="#fff" stroke={c.dot} strokeWidth="1.4" />
      <circle cx={x + w - 5} cy={y + 5} r="3" fill={c.dot} />

      {/* Pretty label */}
      <text x={cx} y={y + h + 13}
        textAnchor="middle"
        fill="#1f2d27"
        style={{ fontSize: 10.5, fontWeight: 600, fontFamily: 'system-ui, sans-serif' }}>
        {slot.label}
      </text>
      <text x={cx} y={y + h + 25}
        textAnchor="middle"
        fill="#6b8278"
        style={{ fontSize: 8.5, fontFamily: "'JetBrains Mono', monospace" }}>
        {(eq.tag || '').slice(-14)}
      </text>
    </g>
  );
}
