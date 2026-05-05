/**
 * Cascading-failure prediction controller.
 *
 * Single equipment failure predictions miss the bigger picture: if Pump A
 * fails it stresses Pump B downstream, the flotation cell that follows,
 * etc. This controller walks the dependency graph (config/equipmentDependencies.js)
 * and combines, for every node:
 *
 *    base_risk      = max(latest failure_prob, 1 - latest health_score/100,
 *                          recent anomaly count / 10)
 *    cascade_risk   = max over all upstream paths of (base_risk_upstream * weight_path)
 *    combined_risk  = 1 - (1-base_risk) * (1-cascade_risk)
 *
 * The result is a list of cascade chains the operator should care about,
 * with concrete equipment_ids, time-to-impact estimate, and a human
 * readable description ready to drop into a notification.
 *
 * Route: GET /api/predictions/cascade        -> top N risky chains
 *        GET /api/predictions/cascade/:eqId  -> downstream chain from one asset
 */
'use strict';

const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { DEPENDENCIES, findDeps, matchesDownstream, resolveDownstream } = require('../config/equipmentDependencies');
const logger = require('../config/logger');

/* ── Pull every equipment with its latest health/failure/anomaly stats ── */
async function loadEquipmentRisk() {
  const { rows } = await query(`
    WITH latest_failure AS (
      SELECT DISTINCT ON (equipment_id)
             equipment_id, failure_prob, predicted_class, ts
      FROM predictions_failure
      ORDER BY equipment_id, ts DESC
    ),
    latest_rul AS (
      SELECT DISTINCT ON (equipment_id)
             equipment_id, health_index, rul_hours, ts
      FROM predictions_rul
      ORDER BY equipment_id, ts DESC
    ),
    recent_anom AS (
      SELECT s.equipment_id, COUNT(*)::int AS n_anom
      FROM predictions_anomaly pa
      JOIN sensors s ON s.sensor_id = pa.sensor_id
      WHERE pa.is_anomaly = TRUE AND pa.ts > NOW() - INTERVAL '6 hours'
      GROUP BY s.equipment_id
    )
    SELECT
      e.equipment_id,
      e.tag_code AS tag,
      e.name,
      e.status,
      e.criticality,
      e.runtime_hours,
      e.expected_life_hours,
      COALESCE(lf.failure_prob, 0)   AS failure_prob,
      lf.predicted_class             AS predicted_class,
      COALESCE(lr.health_index, 1.0) AS health_index,
      lr.rul_hours                   AS rul_hours,
      COALESCE(ra.n_anom, 0)         AS recent_anomalies
    FROM equipment e
    LEFT JOIN latest_failure lf ON lf.equipment_id = e.equipment_id
    LEFT JOIN latest_rul     lr ON lr.equipment_id = e.equipment_id
    LEFT JOIN recent_anom    ra ON ra.equipment_id = e.equipment_id
  `);
  return rows.map(r => {
    // Wear ratio: only meaningful when BOTH runtime & expected_life are set.
    // Without expected_life_hours we cannot estimate wear -> 0 (otherwise
    // every asset would default to 100% risk and the panel becomes useless).
    const runtime  = Number(r.runtime_hours);
    const lifespan = Number(r.expected_life_hours);
    const wearRatio = (lifespan > 0 && runtime >= 0)
      ? Math.min(1, runtime / lifespan)
      : 0;
    const wearRisk  = Math.pow(wearRatio, 3);   // accelerates near end-of-life

    // ML health_index (0..1, 1=healthy). Only use when a prediction exists.
    const hasRulPrediction = r.rul_hours != null && r.health_index != null;
    const healthRisk = hasRulPrediction
      ? Math.max(0, Math.min(1, 1 - Number(r.health_index)))
      : wearRisk;

    // Anomaly contribution capped so 1 anomaly != 10% risk on its own
    const anomRisk = Math.min(1, (Number(r.recent_anomalies) || 0) / 10);

    let baseRisk = Math.max(
      Number(r.failure_prob) || 0,
      healthRisk,
      anomRisk,
    );

    // Status overrides — only push UP, never down
    if (r.status === 'fault')             baseRisk = Math.max(baseRisk, 0.95);
    else if (r.status === 'maintenance')  baseRisk = Math.max(baseRisk, 0.55);
    else if (r.status === 'idle')         baseRisk = Math.max(baseRisk, wearRisk * 0.6);

    // Final clamp so anything above 1 is impossible
    baseRisk = Math.max(0, Math.min(1, baseRisk));
    return { ...r, base_risk: baseRisk };
  });
}

/* ── Compute cascade chains starting from one equipment ── */
function buildChain(rootEq, allByTag, depth = 0, visited = new Set()) {
  if (depth > 4) return [];               // safety: prevent loops
  if (visited.has(rootEq.tag)) return [];
  visited.add(rootEq.tag);

  const deps = findDeps(rootEq.tag, rootEq.name);
  if (!deps) return [];

  const chains = [];
  for (const d of deps.downstream) {
    // Match downstream equipment by tag key OR tagSubstrings (handles real OCP tags)
    const targets = Object.values(allByTag).filter(eq => matchesDownstream(eq, d));
    for (const tgt of targets) {
      const propagated = (rootEq.base_risk || 0) * d.weight;
      const combined   = 1 - (1 - (tgt.base_risk || 0)) * (1 - propagated);
      chains.push({
        upstream:        { id: rootEq.equipment_id, tag: rootEq.tag, name: rootEq.name, base_risk: rootEq.base_risk },
        downstream:      { id: tgt.equipment_id,   tag: tgt.tag,   name: tgt.name,   base_risk: tgt.base_risk },
        weight:          d.weight,
        propagated_risk: propagated,
        combined_risk:   combined,
        hours_to_impact: d.hours,
        description:     d.description,
        depth,
      });
      // Recurse: tgt now becomes the upstream of its own downstreams
      chains.push(...buildChain({ ...tgt, base_risk: combined }, allByTag, depth + 1, new Set(visited)));
    }
  }
  return chains;
}

/* ── GET /api/predictions/cascade ── */
const cascade = asyncHandler(async (req, res) => {
  const minRisk = Math.max(0, Math.min(1, Number(req.query.min) || 0.30));
  const limit   = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 15));

  const equipment = await loadEquipmentRisk();
  const byTag = {};
  equipment.forEach(e => { byTag[e.tag] = e; });

  // Roots = anything that's an upstream node and has measurable risk
  const allChains = [];
  for (const eq of equipment) {
    if (!findDeps(eq.tag, eq.name)) continue;  // not in graph as upstream
    if ((eq.base_risk || 0) < 0.05) continue;  // ignore healthy nodes
    allChains.push(...buildChain(eq, byTag));
  }

  // De-duplicate (upstream → downstream) keeping highest combined_risk
  const dedup = {};
  for (const c of allChains) {
    const k = `${c.upstream.id}->${c.downstream.id}`;
    if (!dedup[k] || dedup[k].combined_risk < c.combined_risk) dedup[k] = c;
  }

  const chains = Object.values(dedup)
    .filter(c => c.combined_risk >= minRisk)
    .sort((a, b) => b.combined_risk - a.combined_risk)
    .slice(0, limit);

  res.json({
    generated_at: new Date().toISOString(),
    n_equipment:  equipment.length,
    chains,
    summary: {
      total_chains:    chains.length,
      critical_chains: chains.filter(c => c.combined_risk >= 0.7).length,
      warning_chains:  chains.filter(c => c.combined_risk >= 0.4 && c.combined_risk < 0.7).length,
    },
  });
});

/* ── GET /api/predictions/cascade/:equipmentId ── */
const cascadeFor = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.equipmentId, 10);
  if (!Number.isFinite(id)) throw new ApiError(400, 'invalid equipment id');

  const equipment = await loadEquipmentRisk();
  const root = equipment.find(e => e.equipment_id === id);
  if (!root) throw new ApiError(404, 'equipment not found');

  const byTag = {};
  equipment.forEach(e => { byTag[e.tag] = e; });

  const chains = buildChain(root, byTag).sort((a, b) => b.combined_risk - a.combined_risk);
  res.json({
    root: { id: root.equipment_id, tag: root.tag, name: root.name, base_risk: root.base_risk },
    chains,
    has_dependencies: !!findDeps(root.tag, root.name),
  });
});

/* ── GET /api/predictions/cascade/graph (debug / UI helper) ── */
const cascadeGraph = asyncHandler(async (_req, res) => {
  res.json({ dependencies: DEPENDENCIES });
});

module.exports = { cascade, cascadeFor, cascadeGraph };
