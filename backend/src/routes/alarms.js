'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/alarmController');
const { authRequired, requirePerm } = require('../middleware/auth');

const router = Router();
router.use(authRequired);

router.get ('/stats',        ctrl.stats);
router.get ('/',             ctrl.list);
router.get ('/:id',          ctrl.getOne);   // single-alarm detail (deep-link)
router.post('/:id/ack',      requirePerm('alarms', 'w'), ctrl.ack);
router.post('/:id/clear',    requirePerm('alarms', 'w'), ctrl.clear);

module.exports = router;
