'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/maintenanceController');
const { authRequired, requirePerm } = require('../middleware/auth');

const router = Router();
router.use(authRequired);

router.get   ('/',        ctrl.list);
router.post  ('/',        requirePerm('maintenance','w'), ctrl.create);
router.patch ('/:id',     requirePerm('maintenance','w'), ctrl.update);
router.delete('/:id',     requirePerm('maintenance','w'), ctrl.remove);

module.exports = router;
