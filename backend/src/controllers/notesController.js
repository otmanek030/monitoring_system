/**
 * Operator shift notes.
 *
 * Anyone with notes:r can read, notes:w can create/update their own notes.
 * Supervisors/admins (notes:rw + users:r) can edit/delete anyone's.
 *
 * Note shape returned to the frontend is flat-friendly:
 *   { id, user_id, author, shift, category, title, body, severity,
 *     equipment_id, equipment_tag, created_at, updated_at }
 */
'use strict';

const { query } = require('../config/db');
const { ApiError, asyncHandler } = require('../middleware/errorHandler');

const CATS  = ['observation', 'incident', 'handover', 'maintenance', 'safety'];
const SEVS  = ['info', 'warning', 'critical'];
const SHIFTS = ['day', 'afternoon', 'night'];

function decorate(r) {
  if (!r) return r;
  return {
    id:            r.note_id,
    note_id:       r.note_id,
    user_id:       r.user_id,
    author:        r.author || r.username || null,
    shift:         r.shift,
    category:      r.category,
    title:         r.title,
    body:          r.body,
    severity:      r.severity,
    equipment_id:  r.equipment_id,
    equipment_tag: r.equipment_tag || null,
    created_at:    r.created_at,
    updated_at:    r.updated_at,
  };
}

function parseId(raw, what = 'id') {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new ApiError(400, `Invalid ${what}`);
  return n;
}

/** Can this user edit/delete a note that belongs to someone else? */
function canManageOthers(user) {
  const p = user?.permissions || {};
  return p['*'] === '*' || p.users === 'r' || p.users === 'rw'
      || (typeof p.notes === 'string' && p.notes.includes('w') && p.users);
}

// GET /api/notes?shift=&category=&equipment=&mine=1&limit=
const list = asyncHandler(async (req, res) => {
  const { shift, category, equipment, mine, severity } = req.query;
  const limit = Math.min(500, parseInt(req.query.limit, 10) || 200);

  const where = [];
  const params = [];
  if (shift)     { params.push(shift);     where.push(`n.shift = $${params.length}`); }
  if (category)  { params.push(category);  where.push(`n.category = $${params.length}`); }
  if (severity)  { params.push(severity);  where.push(`n.severity = $${params.length}`); }
  if (equipment) { params.push(parseId(equipment, 'equipment id'));
                   where.push(`n.equipment_id = $${params.length}`); }
  if (mine === '1' || mine === 'true') {
    params.push(req.user.id);
    where.push(`n.user_id = $${params.length}`);
  }
  params.push(limit);
  const { rows } = await query(
    `SELECT n.*,
            u.username AS author,
            e.tag_code AS equipment_tag
     FROM operator_notes n
     JOIN users u ON u.user_id = n.user_id
     LEFT JOIN equipment e ON e.equipment_id = n.equipment_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY n.created_at DESC
     LIMIT $${params.length}`,
    params
  );
  const items = rows.map(decorate);
  res.json({ items, count: items.length });
});

const getOne = asyncHandler(async (req, res) => {
  const id = parseId(req.params.id, 'note id');
  const { rows } = await query(
    `SELECT n.*, u.username AS author, e.tag_code AS equipment_tag
     FROM operator_notes n
     JOIN users u ON u.user_id = n.user_id
     LEFT JOIN equipment e ON e.equipment_id = n.equipment_id
     WHERE n.note_id = $1`, [id]);
  if (!rows[0]) throw new ApiError(404, 'Note not found');
  res.json(decorate(rows[0]));
});

const create = asyncHandler(async (req, res) => {
  const {
    title, body,
    shift = 'day', category = 'observation', severity = 'info',
    equipment_id = null,
  } = req.body || {};
  if (!title || !body) throw new ApiError(400, 'title and body required');
  if (!SHIFTS.includes(shift))     throw new ApiError(400, 'invalid shift');
  if (!CATS.includes(category))    throw new ApiError(400, 'invalid category');
  if (!SEVS.includes(severity))    throw new ApiError(400, 'invalid severity');

  const eqId = equipment_id == null || equipment_id === ''
    ? null
    : parseId(equipment_id, 'equipment id');

  const { rows } = await query(
    `INSERT INTO operator_notes
       (user_id, equipment_id, shift, category, title, body, severity)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.user.id, eqId, shift, category, title, body, severity]);

  // fetch with join for decorated response
  const { rows: full } = await query(
    `SELECT n.*, u.username AS author, e.tag_code AS equipment_tag
     FROM operator_notes n
     JOIN users u ON u.user_id = n.user_id
     LEFT JOIN equipment e ON e.equipment_id = n.equipment_id
     WHERE n.note_id = $1`, [rows[0].note_id]);

  res.status(201).json(decorate(full[0]));
});

const update = asyncHandler(async (req, res) => {
  const id = parseId(req.params.id, 'note id');

  // Load for owner check
  const { rows: cur } = await query(
    'SELECT user_id FROM operator_notes WHERE note_id = $1', [id]);
  if (!cur[0]) throw new ApiError(404, 'Note not found');
  if (cur[0].user_id !== req.user.id && !canManageOthers(req.user))
    throw new ApiError(403, 'You can only edit your own notes');

  const editable = ['title', 'body', 'shift', 'category', 'severity', 'equipment_id'];
  const updates = [];
  const params  = [];
  for (const f of editable) {
    if (req.body[f] === undefined) continue;
    let v = req.body[f];
    if (f === 'shift'    && !SHIFTS.includes(v)) throw new ApiError(400, 'invalid shift');
    if (f === 'category' && !CATS.includes(v))   throw new ApiError(400, 'invalid category');
    if (f === 'severity' && !SEVS.includes(v))   throw new ApiError(400, 'invalid severity');
    if (f === 'equipment_id' && v != null && v !== '')
      v = parseId(v, 'equipment id');
    params.push(v);
    updates.push(`${f} = $${params.length}`);
  }
  if (!updates.length) throw new ApiError(400, 'No fields to update');
  params.push(id);
  await query(
    `UPDATE operator_notes SET ${updates.join(', ')} WHERE note_id = $${params.length}`,
    params);

  const { rows: full } = await query(
    `SELECT n.*, u.username AS author, e.tag_code AS equipment_tag
     FROM operator_notes n
     JOIN users u ON u.user_id = n.user_id
     LEFT JOIN equipment e ON e.equipment_id = n.equipment_id
     WHERE n.note_id = $1`, [id]);

  res.json(decorate(full[0]));
});

const remove = asyncHandler(async (req, res) => {
  const id = parseId(req.params.id, 'note id');
  const { rows: cur } = await query(
    'SELECT user_id FROM operator_notes WHERE note_id = $1', [id]);
  if (!cur[0]) throw new ApiError(404, 'Note not found');
  if (cur[0].user_id !== req.user.id && !canManageOthers(req.user))
    throw new ApiError(403, 'You can only delete your own notes');
  await query('DELETE FROM operator_notes WHERE note_id = $1', [id]);
  res.json({ ok: true, id });
});

module.exports = { list, getOne, create, update, remove };
