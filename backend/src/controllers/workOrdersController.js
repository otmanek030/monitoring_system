/**
 * Work-orders controller — auto-generated maintenance drafts.
 *
 * The flow is:
 *
 *   1. ML service / cascade controller flags equipment as at risk.
 *   2. autoGenerate() scans recent failure / RUL predictions and inserts
 *      draft `work_orders` rows (status='pending') for any equipment that
 *      doesn't already have an open draft.
 *   3. Supervisor sees the drafts in the Maintenance UI and clicks
 *      "Approve" or "Reject":
 *         approve -> creates a real maintenance_orders row, sets the draft
 *                    status='converted' and stores converted_to_order_id.
 *         reject  -> sets status='rejected' with the reason.
 *
 * The drafts are intentionally kept separate from `maintenance_orders` so
 * the supervisor can curate them without polluting the real schedule.
 */
'use strict';

const { query } = require('../config/db');
const { ApiError, asyncHandler } = require('../middleware/errorHandler');
const logger = require('../config/logger');

/* ── Recommendation templates ─────────────────────────────────────── */
/* Maps predicted failure mode → recommended action / parts list. Easy
   to extend without touching code. */
const FAILURE_RECIPES = {
  bearing_fault: {
    action: 'Replace bearing assembly. Inspect shaft for scoring. Re-grease housing.',
    parts:  'Bearing 6205-2RS (×2), Grease NLGI-2 (200g), Sealing ring 25×35×7',
    urgency_at: { critical: 0.85, urgent: 0.65, high: 0.45, normal: 0.25 },
    title: 'Bearing replacement required',
  },
  winding_overheat: {
    action: 'De-energise motor, check insulation resistance, clean cooling fins, verify fan.',
    parts:  'Insulation tester reading required. If <1MΩ → rewind motor. Clean filter mesh.',
    urgency_at: { critical: 0.80, urgent: 0.60, high: 0.40, normal: 0.20 },
    title: 'Motor winding overheat - inspection required',
  },
  cavitation: {
    action: 'Check suction-side pressure and NPSH. Inspect impeller for pitting. Verify flow.',
    parts:  'Impeller (if pitted), Wear ring, Mechanical seal kit',
    urgency_at: { critical: 0.80, urgent: 0.60, high: 0.40, normal: 0.20 },
    title: 'Cavitation suspected - hydraulic check',
  },
  misalignment: {
    action: 'Stop equipment, perform laser alignment, verify foundation bolts and shims.',
    parts:  'Alignment shims (assorted), Coupling element, Foundation grout if cracked',
    urgency_at: { critical: 0.85, urgent: 0.65, high: 0.45, normal: 0.25 },
    title: 'Coupling misalignment detected',
  },
  belt_slip: {
    action: 'Re-tension belt, inspect for wear, verify pulley alignment.',
    parts:  'V-belt (matching set), Tensioner spring, Pulley if grooves worn',
    urgency_at: { critical: 0.85, urgent: 0.65, high: 0.45, normal: 0.25 },
    title: 'Belt slip - tensioning required',
  },
  rul_low: {
    action: 'Schedule planned overhaul before remaining useful life reaches zero.',
    parts:  'Refer to OEM overhaul kit, gather spares before downtime window.',
    urgency_at: { critical: 100, urgent: 240, high: 480, normal: 720 },     // hours
    title: 'Remaining useful life critical',
  },
  generic: {
    action: 'Investigate: review recent vibration/temperature trends and inspect on shift handover.',
    parts:  'TBD after inspection.',
    urgency_at: { critical: 0.85, urgent: 0.65, high: 0.45, normal: 0.25 },
    title: 'Predictive maintenance inspection required',
  },
};

function urgencyFor(modeKey, value, isHours = false) {
  const recipe = FAILURE_RECIPES[modeKey] || FAILURE_RECIPES.generic;
  const t = recipe.urgency_at;
  if (isHours) {
    // Lower hours = higher urgency
    if (value <= t.critical) return 'critical';
    if (value <= t.urgent)   return 'urgent';
    if (value <= t.high)     return 'high';
    return 'normal';
  }
  if (value >= t.critical) return 'critical';
  if (value >= t.urgent)   return 'urgent';
  if (value >= t.high)     return 'high';
  return 'normal';
}

/* ── GET /api/work-orders ─────────────────────────────────────────── */
const list = asyncHandler(async (req, res) => {
  const { status, equipment_id, source } = req.query;
  const where  = [];
  const params = [];
  if (status)       { params.push(status);       where.push(`wo.status = $${params.length}`); }
  if (equipment_id) { params.push(equipment_id); where.push(`wo.equipment_id = $${params.length}`); }
  if (source)       { params.push(source);       where.push(`wo.source = $${params.length}`); }

  const { rows } = await query(
    `SELECT wo.*,
            e.tag_code AS equipment_tag, e.name AS equipment_name,
            cu.username AS created_by_username,
            au.username AS approved_by_username
       FROM work_orders wo
       JOIN equipment e ON e.equipment_id = wo.equipment_id
       LEFT JOIN users cu ON cu.user_id = wo.created_by
       LEFT JOIN users au ON au.user_id = wo.approved_by
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY
        CASE wo.urgency
          WHEN 'critical' THEN 1 WHEN 'urgent' THEN 2
          WHEN 'high' THEN 3     WHEN 'normal' THEN 4
          WHEN 'low' THEN 5      ELSE 6 END,
        wo.created_at DESC`,
    params
  );
  res.json(rows);
});

/* ── GET /api/work-orders/:id ─────────────────────────────────────── */
const get = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT wo.*,
            e.tag_code AS equipment_tag, e.name AS equipment_name
       FROM work_orders wo
       JOIN equipment e ON e.equipment_id = wo.equipment_id
      WHERE wo.work_order_id = $1`, [req.params.id]);
  if (!rows[0]) throw new ApiError(404, 'work order not found');
  res.json(rows[0]);
});

/* ── GET /api/work-orders/pending/count ───────────────────────────── */
const pendingCount = asyncHandler(async (_req, res) => {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS pending,
            COUNT(*) FILTER (WHERE urgency IN ('urgent','critical'))::int AS urgent
       FROM work_orders WHERE status = 'pending'`);
  res.json(rows[0] || { pending: 0, urgent: 0 });
});

/* ── POST /api/work-orders (manual draft) ────────────────────────── */
const create = asyncHandler(async (req, res) => {
  const {
    equipment_id, title, description, recommended_action,
    suggested_parts, urgency = 'normal',
    predicted_failure_type, failure_probability,
  } = req.body || {};
  if (!equipment_id || !title) throw new ApiError(400, 'equipment_id and title required');

  const { rows } = await query(
    `INSERT INTO work_orders
       (equipment_id, title, description, recommended_action, suggested_parts,
        urgency, predicted_failure_type, failure_probability,
        source, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manual',$9)
     RETURNING *`,
    [equipment_id, title, description || null, recommended_action || null,
     suggested_parts || null, urgency, predicted_failure_type || null,
     failure_probability || null, req.user.id]);
  res.status(201).json(rows[0]);
});

/* ── POST /api/work-orders/auto-generate ──────────────────────────── *
 * Scans the latest failure & RUL predictions and inserts pending drafts
 * for any equipment that crosses the alert thresholds. The unique index
 * `uq_wo_pending_dedup` makes this idempotent: we won't double-create a
 * draft for the same equipment + failure type while one is still pending.
 */
const autoGenerate = asyncHandler(async (req, res) => {
  const userId = req.user?.id || null;

  // 1. High-probability failure predictions (< 24h old, prob >= 0.5)
  const { rows: failures } = await query(`
    SELECT DISTINCT ON (pf.equipment_id)
           pf.equipment_id, pf.predicted_class, pf.failure_prob,
           pf.prediction_id, pf.ts,
           e.tag_code, e.name
      FROM predictions_failure pf
      JOIN equipment e ON e.equipment_id = pf.equipment_id
     WHERE pf.ts > NOW() - INTERVAL '24 hours'
       AND pf.failure_prob >= 0.5
     ORDER BY pf.equipment_id, pf.ts DESC
  `);

  // 2. RUL predictions where rul_hours <= 720h (~30 days)
  const { rows: ruls } = await query(`
    SELECT DISTINCT ON (pr.equipment_id)
           pr.equipment_id, pr.rul_hours, pr.health_index, pr.ts,
           e.tag_code, e.name
      FROM predictions_rul pr
      JOIN equipment e ON e.equipment_id = pr.equipment_id
     WHERE pr.ts > NOW() - INTERVAL '24 hours'
       AND pr.rul_hours IS NOT NULL
       AND pr.rul_hours <= 720
     ORDER BY pr.equipment_id, pr.ts DESC
  `);

  const created = [];
  const skipped = [];

  // ── Failure-mode based drafts ──
  for (const f of failures) {
    const mode   = (f.predicted_class || 'generic').toLowerCase();
    const recipe = FAILURE_RECIPES[mode] || FAILURE_RECIPES.generic;
    const urg    = urgencyFor(mode, Number(f.failure_prob), false);
    const title  = `[${f.tag_code}] ${recipe.title} (${Math.round(f.failure_prob * 100)}% probability)`;
    try {
      const { rows } = await query(
        `INSERT INTO work_orders
           (equipment_id, predicted_failure_type, failure_probability,
            title, description, recommended_action, suggested_parts,
            urgency, source, triggered_by_prediction_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'prediction',$9,$10)
         ON CONFLICT (equipment_id, predicted_failure_type)
         WHERE status = 'pending' AND source <> 'manual'
         DO NOTHING
         RETURNING *`,
        [f.equipment_id, mode, Number(f.failure_prob),
         title,
         `Predictive model flagged ${mode.replace('_',' ')} on ${f.tag_code} (${f.name}). ` +
           `Predicted failure probability ${Math.round(f.failure_prob * 100)}% within the next 7-14 days.`,
         recipe.action, recipe.parts,
         urg, f.prediction_id, userId]
      );
      if (rows[0]) created.push(rows[0]);
      else skipped.push({ equipment_id: f.equipment_id, reason: 'already pending' });
    } catch (e) {
      logger.warn('autoGenerate failure insert failed', { err: e.message, equipment_id: f.equipment_id });
    }
  }

  // ── RUL-based drafts ──
  for (const r of ruls) {
    const hours = Number(r.rul_hours);
    const urg   = urgencyFor('rul_low', hours, true);
    if (urg === 'normal' && hours > 480) continue;     // skip non-urgent RUL
    const recipe = FAILURE_RECIPES.rul_low;
    const title  = `[${r.tag_code}] RUL low — ${Math.round(hours)}h remaining`;
    try {
      const { rows } = await query(
        `INSERT INTO work_orders
           (equipment_id, predicted_failure_type, rul_hours, health_index,
            title, description, recommended_action, suggested_parts,
            urgency, source, created_by)
         VALUES ($1,'rul_low',$2,$3,$4,$5,$6,$7,$8,'rul',$9)
         ON CONFLICT (equipment_id, predicted_failure_type)
         WHERE status = 'pending' AND source <> 'manual'
         DO NOTHING
         RETURNING *`,
        [r.equipment_id, hours, r.health_index ? Number(r.health_index) * 100 : null,
         title,
         `LSTM remaining-useful-life model estimates ${Math.round(hours)} operating hours ` +
           `before ${r.tag_code} reaches end-of-life. Schedule planned overhaul to avoid an unscheduled outage.`,
         recipe.action, recipe.parts, urg, userId]
      );
      if (rows[0]) created.push(rows[0]);
      else skipped.push({ equipment_id: r.equipment_id, reason: 'already pending' });
    } catch (e) {
      logger.warn('autoGenerate rul insert failed', { err: e.message, equipment_id: r.equipment_id });
    }
  }

  res.json({
    generated_at: new Date().toISOString(),
    n_failures_scanned: failures.length,
    n_ruls_scanned:     ruls.length,
    n_created:          created.length,
    n_skipped:          skipped.length,
    created,
    skipped,
  });
});

/* ── POST /api/work-orders/:id/approve ─────────────────────────────
 * Convert a draft into a real maintenance_orders row.
 * Body (optional): { assigned_to, planned_start, planned_end, priority }
 */
const approve = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new ApiError(400, 'invalid id');

  const { rows: draftRows } = await query(
    `SELECT * FROM work_orders WHERE work_order_id = $1`, [id]);
  const draft = draftRows[0];
  if (!draft) throw new ApiError(404, 'draft not found');
  if (draft.status !== 'pending')
    throw new ApiError(400, `cannot approve a draft with status ${draft.status}`);

  const { assigned_to, planned_start, planned_end } = req.body || {};

  // Map urgency → maintenance priority
  const priorityMap = {
    critical: 'urgent', urgent: 'urgent', high: 'high', normal: 'normal', low: 'low',
  };

  const description = [
    draft.description,
    draft.recommended_action ? `\nRecommended action:\n${draft.recommended_action}` : '',
    draft.suggested_parts    ? `\nSuggested parts:\n${draft.suggested_parts}`        : '',
    draft.failure_probability != null
      ? `\nML failure probability: ${Math.round(draft.failure_probability * 100)}%`
      : '',
    draft.rul_hours != null
      ? `\nRUL: ${Math.round(draft.rul_hours)}h remaining`
      : '',
  ].filter(Boolean).join('\n');

  const { rows: orderRows } = await query(
    `INSERT INTO maintenance_orders
       (equipment_id, order_type, priority, title, description,
        created_by, assigned_to, triggered_by_prediction_id,
        planned_start, planned_end)
     VALUES ($1,'predictive',$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [draft.equipment_id,
     priorityMap[draft.urgency] || 'normal',
     draft.title,
     description,
     req.user.id,
     assigned_to || null,
     draft.triggered_by_prediction_id || null,
     planned_start ? new Date(planned_start) : null,
     planned_end   ? new Date(planned_end)   : null]
  );
  const order = orderRows[0];

  await query(
    `UPDATE work_orders
        SET status = 'converted',
            approved_by = $1,
            approved_at = NOW(),
            converted_to_order_id = $2
      WHERE work_order_id = $3`,
    [req.user.id, order.order_id, id]);

  res.json({ ok: true, work_order_id: id, maintenance_order: order });
});

/* ── POST /api/work-orders/:id/reject ───────────────────────────── */
const reject = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new ApiError(400, 'invalid id');
  const reason = (req.body?.reason || '').toString().slice(0, 500);

  const { rows } = await query(
    `UPDATE work_orders
        SET status = 'rejected',
            approved_by = $1,
            approved_at = NOW(),
            rejection_reason = $2
      WHERE work_order_id = $3 AND status = 'pending'
      RETURNING *`,
    [req.user.id, reason || null, id]);
  if (!rows[0]) throw new ApiError(404, 'pending draft not found');
  res.json(rows[0]);
});

module.exports = { list, get, create, approve, reject, autoGenerate, pendingCount };
