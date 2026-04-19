'use strict';

/**
 * Operator shift notes.
 * Mounted at /api/notes.
 *
 *   GET    /api/notes                   list/filter
 *   GET    /api/notes/:id               single note
 *   POST   /api/notes                   create (writes as req.user)
 *   PATCH  /api/notes/:id               edit (own note, or mgr)
 *   DELETE /api/notes/:id               delete (own note, or mgr)
 */
const { Router } = require('express');
const ctrl = require('../controllers/notesController');
const { authRequired, requirePerm } = require('../middleware/auth');

const router = Router();
router.use(authRequired);

router.get   ('/',      requirePerm('notes', 'r'), ctrl.list);
router.get   ('/:id',   requirePerm('notes', 'r'), ctrl.getOne);
router.post  ('/',      requirePerm('notes', 'w'), ctrl.create);
router.patch ('/:id',   requirePerm('notes', 'w'), ctrl.update);
router.delete('/:id',   requirePerm('notes', 'w'), ctrl.remove);

module.exports = router;
