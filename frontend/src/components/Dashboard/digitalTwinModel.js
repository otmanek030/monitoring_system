/**
 * digitalTwinModel - layout, pipes, and lookup helpers for the Digital
 * Twin component. Pure data + tiny utility functions, no JSX.
 */

/* Slot definitions - position is inside a 1100 x 440 viewBox.
   `keys` are case-insensitive substrings matched against tag_code AND name. */
export const LAYOUT = {
  HOPPER: {
    pos: { x: 50,  y: 70, w: 90, h: 80 },
    shape: 'hopper', label: 'Feed Hopper',
    keys: ['HOPPER','TREMIE','SILO_FEED','SILO FEED'],
  },
  CONV_FEED: {
    pos: { x: 175, y: 100, w: 110, h: 22 },
    shape: 'belt', label: 'Feed Belt',
    keys: ['CONV_B','BELT CONV','BELT_CONV','CONVEYOR','COURROIE'],
  },
  PUMP_FEED: {
    pos: { x: 200, y: 220, w: 60, h: 60 },
    shape: 'pump', label: 'Feed Pump',
    keys: ['VP_01','VP_0','FEED PUMP','FEED_PUMP','PUMP_FEED','POMPE ALIM'],
  },
  SCRUBBER: {
    pos: { x: 320, y: 80, w: 110, h: 70 },
    shape: 'drum', label: 'Wash Drum',
    keys: ['SCRUB','AG_24','WASHING DRUM','WASH DRUM','DRUM AGIT','DRUM_AGIT'],
  },
  HYDRO_1: {
    pos: { x: 470, y: 50, w: 60, h: 90 },
    shape: 'cyclone', label: 'Cyclone-1',
    keys: ['HYDRO_1','HYDRO1','CY_03','CYCLON_1','DEWATERING','CYCLONE_1','CYCLON 1'],
  },
  HYDRO_2: {
    pos: { x: 470, y: 165, w: 60, h: 90 },
    shape: 'cyclone', label: 'Cyclone-2',
    keys: ['HYDRO_2','HYDRO2','CY_04','CY_1','CYCLON_2','CYCLONE_2','CYCLON 2'],
  },
  PUMP_SLURRY: {
    pos: { x: 470, y: 290, w: 60, h: 60 },
    shape: 'pump', label: 'Slurry Pump',
    keys: ['SP_07','SP_0','320A_SP','INTER-CELL','INTER CELL','SLURRY PUMP'],
  },
  FLOAT_1: {
    pos: { x: 580, y: 70, w: 80, h: 90 },
    shape: 'cell', label: 'Flotation 1',
    keys: ['FY_01','FY_0','FLOAT_1','FLOTATION CELL','FLOT_CELL','BANK 01','FLOTATION 1'],
  },
  FLOAT_2: {
    pos: { x: 680, y: 70, w: 80, h: 90 },
    shape: 'cell', label: 'Flotation 2',
    keys: ['FY_02','FY_1','FLOAT_2','FLOTATION 2','BANK 02'],
  },
  FLOAT_3: {
    pos: { x: 780, y: 70, w: 80, h: 90 },
    shape: 'cell', label: 'Flotation 3',
    keys: ['FY_03','FY_2','FLOAT_3','FLOTATION 3','BANK 03'],
  },
  AGIT_1: {
    pos: { x: 600, y: 175, w: 28, h: 28 },
    shape: 'agit', label: 'Agitator 1',
    keys: ['AGIT_1','AG_1','AGIT1','AGITATOR 1','AGITATEUR 1'],
  },
  AGIT_2: {
    pos: { x: 700, y: 175, w: 28, h: 28 },
    shape: 'agit', label: 'Agitator 2',
    keys: ['AGIT_2','AG_2','AGIT2','AGITATOR 2','AGITATEUR 2'],
  },
  TAIL_TANK: {
    pos: { x: 600, y: 250, w: 110, h: 90 },
    shape: 'tank', label: 'Tailings Tank',
    keys: ['TAIL_TANK','TANK_TAIL','TAILINGS TANK','TK_TAIL','TAIL TANK'],
  },
  CONC_TANK: {
    pos: { x: 880, y: 60, w: 90, h: 110 },
    shape: 'tank', label: 'Concentrate Tank',
    keys: ['CONC_TANK','TANK_CONC','CONCENTRATE TANK','TK_CON','CONC TANK'],
  },
  PUMP_CONC: {
    pos: { x: 880, y: 200, w: 60, h: 60 },
    shape: 'pump', label: 'Concentrate Pump',
    keys: ['SP_12','SP_1','TAILINGS SLURRY','TAIL PUMP','PUMP_CONC','CONC PUMP','CONCENTRATE PUMP'],
  },
  STACKER: {
    pos: { x: 1000, y: 90, w: 80, h: 80 },
    shape: 'stacker', label: 'Stacker',
    keys: ['STKR','STACKER','STACKER_01','RADIAL STACKER','EMPILEUR'],
  },
  BOILER: {
    pos: { x: 50,  y: 290, w: 110, h: 90 },
    shape: 'boiler', label: 'Boiler',
    keys: ['BOILER','CHAUDIERE','STEAM','BLR_','CALDEIRA'],
  },
};

/* Connection ports — pipes attach to edges, not centres. */
export function port(slot, side) {
  const { x, y, w, h } = slot.pos;
  switch (side) {
    case 'l': return { x: x,         y: y + h / 2 };
    case 'r': return { x: x + w,     y: y + h / 2 };
    case 't': return { x: x + w / 2, y: y          };
    case 'b': return { x: x + w / 2, y: y + h      };
    default:  return { x: x + w / 2, y: y + h / 2 };
  }
}

export const PIPES = [
  { from: 'HOPPER',     fSide: 'r', to: 'CONV_FEED',  tSide: 'l' },
  { from: 'CONV_FEED',  fSide: 'r', to: 'SCRUBBER',   tSide: 'l' },
  { from: 'PUMP_FEED',  fSide: 't', to: 'SCRUBBER',   tSide: 'b' },
  { from: 'SCRUBBER',   fSide: 'r', to: 'HYDRO_1',    tSide: 'l' },
  { from: 'SCRUBBER',   fSide: 'r', to: 'HYDRO_2',    tSide: 'l' },
  { from: 'HYDRO_1',    fSide: 'r', to: 'FLOAT_1',    tSide: 'l' },
  { from: 'HYDRO_2',    fSide: 'r', to: 'FLOAT_1',    tSide: 'l' },
  { from: 'FLOAT_1',    fSide: 'r', to: 'FLOAT_2',    tSide: 'l' },
  { from: 'FLOAT_2',    fSide: 'r', to: 'FLOAT_3',    tSide: 'l' },
  { from: 'FLOAT_3',    fSide: 'r', to: 'CONC_TANK',  tSide: 'l' },
  { from: 'CONC_TANK',  fSide: 'b', to: 'PUMP_CONC',  tSide: 't' },
  { from: 'PUMP_CONC',  fSide: 'r', to: 'STACKER',    tSide: 'l' },
  { from: 'FLOAT_1',    fSide: 'b', to: 'TAIL_TANK',  tSide: 't' },
  { from: 'TAIL_TANK',  fSide: 'l', to: 'PUMP_SLURRY',tSide: 'r' },
];

/* Build an orthogonal SVG path with one bend (L-shape). */
export function elbowPath(p1, p2) {
  const dx = Math.abs(p2.x - p1.x);
  const dy = Math.abs(p2.y - p1.y);
  if (dx < 4 || dy < 4) return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
  if (dx >= dy) return `M ${p1.x} ${p1.y} L ${p2.x} ${p1.y} L ${p2.x} ${p2.y}`;
  return `M ${p1.x} ${p1.y} L ${p1.x} ${p2.y} L ${p2.x} ${p2.y}`;
}

/* Find the slot that matches an equipment row (by tag or name). */
export function matchSlot(eq) {
  const t = (eq.tag || eq.tag_code || '').toUpperCase();
  const n = (eq.name || '').toUpperCase();
  for (const [key, slot] of Object.entries(LAYOUT)) {
    if (t.includes(key)) return key;
    if (slot.keys.some(k => t.includes(k.toUpperCase()) || n.includes(k.toUpperCase()))) return key;
  }
  return null;
}

/* Status -> colour palette */
export function statusColors(eq) {
  if (eq.status === 'fault')          return { fill: '#fee2e2', stroke: '#dc2626', dot: '#dc2626', text: '#991b1b', glow: '#fca5a5' };
  if (eq.status === 'maintenance')    return { fill: '#fef3c7', stroke: '#d97706', dot: '#d97706', text: '#92400e', glow: '#fcd34d' };
  if (eq.status === 'stopped' || eq.status === 'idle')
                                      return { fill: '#f1f5f9', stroke: '#94a3b8', dot: '#94a3b8', text: '#475569', glow: '#cbd5e1' };
  const h = Number(eq.health_score) || 0;
  if (h < 40)  return { fill: '#fee2e2', stroke: '#dc2626', dot: '#dc2626', text: '#991b1b', glow: '#fca5a5' };
  if (h < 70)  return { fill: '#fef3c7', stroke: '#d97706', dot: '#d97706', text: '#92400e', glow: '#fcd34d' };
  return { fill: '#dcfce7', stroke: '#16a34a', dot: '#16a34a', text: '#166534', glow: '#86efac' };
}
