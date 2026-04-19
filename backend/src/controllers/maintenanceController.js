/**
 * Maintenance orders CRUD.
 */
'use strict';

const { query } = require('../config/db');
const { ApiError, asyncHandler } = require('../middleware/errorHandler');

const list = asyncHandler(async (req, res) => {
  const { status, equipment } = req.query;
  const where = [];
  const params = [];
  if (status)    { params.push(status);    where.push(`mo.status = $${params.length}`); }
  if (equipment) { params.push(equipment); where.push(`mo.equipment_id = $${params.length}`); }
  const { rows } = await query(
    `SELECT mo.*,
            e.tag_code AS equipment_tag, e.name AS equipment_name,
            cu.username AS created_by_username,
            au.username AS assigned_to_username
     FROM maintenance_orders mo
     JOIN equipment e ON e.equipment_id = mo.equipment_id
     LEFT JOIN users cu ON cu.user_id = mo.created_by
     LEFT JOIN users au ON au.user_id = mo.assigned_to
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY mo.created_at DESC`,
    params
  );
  res.json(rows);
});

const create = asyncHandler(async (req, res) => {
  const {
    equipment_id, order_type = 'preventive', priority = 'normal',
    title, description, planned_start, planned_end, assigned_to,
  } = req.body || {};
  if (!equipment_id || !title) throw new ApiError(400, 'equipment_id and title required');
  const { rows } = await query(
    `INSERT INTO maintenance_orders
       (equipment_id, order_type, priority, title, description,
        created_by, assigned_to, planned_start, planned_end)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [equipment_id, order_type, priority, title, description || null,
     req.user.id, assigned_to || null,
     planned_start ? new Date(planned_start) : null,
     planned_end   ? new Date(planned_end)   : null]
  );
  res.status(201).json(rows[0]);
});

const update = asyncHandler(async (req, res) => {
  const fields = ['status','priority','title','description','assigned_to',
                  'planned_start','planned_end','actual_start','actual_end',
                  'cost','parts_replaced','notes'];
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      params.push(req.body[f]);
      updates.push(`${f} = $${params.length}`);
    }
  }
  if (!updates.length) throw new ApiError(400, 'No fields to update');
  params.push(req.params.id);
  const { rows } = await query(
    `UPDATE maintenance_orders SET ${updates.join(', ')}
     WHERE order_id = $${params.length} RETURNING *`,
    params
  );
  if (!rows[0]) throw new ApiError(404, 'Order not found');
  res.json(rows[0]);
});

const remove = asyncHandler(async (req, res) => {
  const { rowCount } = await query(
    'DELETE FROM maintenance_orders WHERE order_id = $1', [req.params.id]);
  if (!rowCount) throw new ApiError(404, 'Order not found');
  res.json({ ok: true });
});

/**
 * PATCH /api/maintenance/:id/assign  body: { assigned_to: <user_id|null> }
 * Supervisor-only route (requirePerm('assign_maintenance','w')).
 * Re-opens the order (status='open') if it was planned/closed before.
 */
const assign = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new ApiError(400, 'Invalid order id');

  let to = req.body?.assigned_to;
  if (to === '' || to === undefined) to = null;
  if (to !== null) {
    to = parseInt(to, 10);
    if (!Number.isFinite(to)) throw new ApiError(400, 'Invalid assignee id');
    const { rows: u } = await query(
      `SELECT u.user_id FROM users u JOIN roles r ON r.role_id = u.role_id
       WHERE u.user_id = $1 AND u.is_active
         AND r.code IN ('technician','supervisor','admin')`, [to]);
    if (!u[0]) throw new ApiError(400, 'Assignee must be an active technician or supervisor');
  }

  const { rows } = await query(
    `UPDATE maintenance_orders
       SET assigned_to = $1,
           status = CASE WHEN status IN ('completed','cancelled') THEN 'scheduled'
                         ELSE status END
     WHERE order_id = $2
     RETURNING *`,
    [to, id]);
  if (!rows[0]) throw new ApiError(404, 'Order not found');
  res.json(rows[0]);
});

module.exports = { list, create, update, remove, assign };
