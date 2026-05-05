/**
 * Equipment dependency graph for the Benguerir washing & flotation circuit.
 *
 * Each entry models the *downstream* relationships of a piece of equipment.
 * If equipment A fails, every entry in A.downstream is at additional risk
 * (the `weight` 0..1 quantifies how much stress the failure transfers).
 *
 * Tags are matched as **substrings**, case-insensitive. So an entry with
 * key `PUMP_FEED` will match equipment whose `tag_code` contains "PUMP_FEED".
 *
 * `description` is a human-readable explanation that appears in the alert
 * UI ("Pump A failure has 73% chance of causing flotation cell disruption
 * within 4 hours").
 *
 * To add a new dependency, append an entry. No code change is required —
 * the cascade controller reads this file at runtime.
 */
'use strict';

/* tagSubstrings: real OCP tag / name substrings that identify this node.
   Matched case-insensitively against both tag_code and name columns. */
const DEPENDENCIES = [
  {
    upstream: 'HOPPER',
    tagSubstrings: ['HOPPER', 'TREMIE', 'SILO_FEED'],
    downstream: [
      { tag: 'CONV_FEED',   tagSubstrings: ['CONV_B','CONVEYOR','BELT CONV'], weight: 0.85, hours: 1, description: 'Feed belt starves without hopper supply' },
      { tag: 'SCRUBBER',    tagSubstrings: ['AG_24','WASHING DRUM','SCRUB'],  weight: 0.55, hours: 2, description: 'Scrubber loses feed material' },
    ],
  },
  {
    upstream: 'CONV_FEED',
    tagSubstrings: ['CONV_B', 'CONVEYOR', 'BELT CONV', '410A_CONV'],
    downstream: [
      { tag: 'SCRUBBER',  tagSubstrings: ['AG_24','WASHING DRUM','SCRUB'],        weight: 0.80, hours: 1, description: 'Scrubber receives no feed' },
      { tag: 'PUMP_FEED', tagSubstrings: ['VP_01','VP_0','FEED PUMP','310A_VP'],  weight: 0.40, hours: 2, description: 'Feed pump runs dry' },
    ],
  },
  {
    upstream: 'PUMP_FEED',
    tagSubstrings: ['VP_01', 'VP_0', 'FEED PUMP', '310A_VP'],
    downstream: [
      { tag: 'SCRUBBER', tagSubstrings: ['AG_24','WASHING DRUM','SCRUB'],             weight: 0.70, hours: 2, description: 'Scrubber loses pressurised slurry' },
      { tag: 'HYDRO_1',  tagSubstrings: ['CY_03','CY_0','CYCLON','DEWATERING'],       weight: 0.55, hours: 3, description: 'Hydrocyclone starved of feed' },
    ],
  },
  {
    upstream: 'SCRUBBER',
    tagSubstrings: ['AG_24', 'WASHING DRUM', 'WASH DRUM', '310A_AG', 'SCRUB'],
    downstream: [
      { tag: 'HYDRO_1', tagSubstrings: ['CY_03','CY_0','CYCLON','DEWATERING'], weight: 0.75, hours: 2, description: 'Cyclone receives unwashed material' },
    ],
  },
  {
    upstream: 'HYDRO_1',
    tagSubstrings: ['CY_03', 'CY_0', 'CYCLON', 'DEWATERING', '330A_CY'],
    downstream: [
      { tag: 'FLOAT_1', tagSubstrings: ['FY_01','FY_0','FLOTATION CELL','FLOTATION 1','BANK 01'], weight: 0.65, hours: 3, description: 'Flotation cell inlet quality degraded after cyclone failure' },
    ],
  },
  {
    upstream: 'FLOAT_1',
    tagSubstrings: ['FY_01', 'FY_0', 'FLOTATION CELL', 'FLOTATION 1', '320A_FY', 'BANK 01'],
    downstream: [
      { tag: 'PUMP_CONC',   tagSubstrings: ['SP_12','SP_1','TAILINGS SLURRY','TAIL'], weight: 0.60, hours: 2, description: 'Output pump receives off-spec concentrate' },
      { tag: 'PUMP_SLURRY', tagSubstrings: ['SP_07','SP_0','SLURRY PUMP'],            weight: 0.35, hours: 4, description: 'Slurry pump volume surges with overflow' },
    ],
  },
  {
    upstream: 'PUMP_SLURRY',
    tagSubstrings: ['SP_07', 'SP_0', 'SLURRY PUMP 07', '320A_SP'],
    downstream: [
      { tag: 'FLOAT_1', tagSubstrings: ['FY_01','FY_0','FLOTATION CELL','BANK 01'], weight: 0.45, hours: 3, description: 'Flotation cell starved of slurry feed' },
    ],
  },
  {
    upstream: 'PUMP_CONC',
    tagSubstrings: ['SP_12', 'SP_1', 'TAILINGS SLURRY', '340G_SP'],
    downstream: [
      { tag: 'STACKER', tagSubstrings: ['STKR','STACKER','RADIAL'], weight: 0.90, hours: 1, description: 'Stacker stops receiving product' },
    ],
  },
  {
    upstream: 'STACKER',
    tagSubstrings: ['STKR', 'STACKER', 'RADIAL', '410A_STKR'],
    downstream: [],
  },
];

/**
 * Find the dependency config that matches a given equipment tag + name.
 * Checks the upstream key first (legacy), then tagSubstrings for real OCP tags.
 */
function findDeps(tag, name) {
  if (!tag && !name) return null;
  const t = (tag  || '').toUpperCase();
  const n = (name || '').toUpperCase();
  return DEPENDENCIES.find(d => {
    if (t.includes(d.upstream)) return true;
    return (d.tagSubstrings || []).some(s => t.includes(s.toUpperCase()) || n.includes(s.toUpperCase()));
  }) || null;
}

/**
 * Check whether an equipment object matches a downstream dependency descriptor.
 * Checks the descriptor's tag key and its tagSubstrings.
 */
function matchesDownstream(eq, descriptor) {
  const t = (eq.tag_code || eq.tag || '').toUpperCase();
  const n = (eq.name || '').toUpperCase();
  if (t.includes(descriptor.tag.toUpperCase())) return true;
  return (descriptor.tagSubstrings || []).some(s => t.includes(s.toUpperCase()) || n.includes(s.toUpperCase()));
}

/**
 * Resolve "downstream tag substring" to actual equipment objects.
 * Used so the controller can return concrete equipment_ids in the response.
 */
function resolveDownstream(downKey, equipmentList) {
  const k = downKey.toUpperCase();
  return equipmentList.filter(eq => (eq.tag_code || eq.tag || '').toUpperCase().includes(k));
}

module.exports = { DEPENDENCIES, findDeps, matchesDownstream, resolveDownstream };
